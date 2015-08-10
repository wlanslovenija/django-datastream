(function ($) {

    /**
     * Plugin for highlighting. It sets a lower opacity for series other than the one that is hovered over.
     */
    (function (Highcharts) {
        function highlightOn(allSeries, currentSeries) {
            return function (event) {
                // Don't do anything if current series is not visible.
                if (!currentSeries.visible) {
                    return;
                }

                _.each(allSeries, function (series, i) {
                    if (i === 0) {
                        // We skip (empty) navigator series.
                        assert.equal(series.data.length, 0);
                        return;
                    }

                    var current = series === currentSeries || series.linkedParent === currentSeries || series.options.streamId === currentSeries.options.streamId;
                    _.each(['group', 'markerGroup'], function (group, j) {
                        if (series[group]) {
                            series[group].attr('opacity', current ? 1.0 : 0.25);
                        }
                    });
                });
            };
        }

        function highlightOff(allSeries, currentSeries) {
            return function (event) {
                // Even if current series is not visible, we still just turn highlighting off, just in case.

                _.each(allSeries, function (series, i) {
                    if (i === 0) {
                        // We skip (empty) navigator series.
                        assert.equal(series.data.length, 0);
                        return;
                    }

                    _.each(['group', 'markerGroup'], function (group, j) {
                        if (series[group]) {
                            series[group].attr('opacity', 1.0);
                        }
                    });
                });
            };
        }

        // Hovering over the legend
        Highcharts.wrap(Highcharts.Legend.prototype, 'renderItem', function (proceed, currentSeries) {
            proceed.call(this, currentSeries);

            var allSeries = this.chart.series;

            $(currentSeries.legendGroup.element).off('.highlight').on(
                'mouseenter.highlight', highlightOn(allSeries, currentSeries)
            ).on(
                'mouseleave.highlight', highlightOff(allSeries, currentSeries)
            );
        });
    }(Highcharts));

    // The language object is global and it can't be set on each chart initiation. Instead, we have to use
    // Highcharts.setOptions to set it before any chart is initiated.
    Highcharts.setOptions({
        'lang': {
            // By default thousands are separated by space. This is pretty confusing.
            'thousandsSep': ''
        }
    });

    // TODO: This currently does not depend on how many datapoints are really available, so if granularity is seconds, it assumes that every second will have a datapoint.
    var MAX_POINTS_NUMBER = 300;
    // TODO: How much exactly do we want?
    var MAX_POINTS_LOAD_LIMIT = 1000;

    // The order of entries is from the lowest to the highest granularity on purpose,
    // so that computing the granularity from a range is easier. Duration is in seconds.
    var GRANULARITIES = [
        {'name': 'days', 'duration': 24 * 60 * 60, 'order': -30},
        {'name': '6hours', 'duration': 6 * 60 * 60, 'order': -21},
        {'name': 'hours', 'duration': 60 * 60, 'order': -20},
        {'name': '10minutes', 'duration': 10 * 60, 'order': -11},
        {'name': 'minutes', 'duration': 60, 'order': -10},
        {'name': '10seconds', 'duration': 10, 'order': -1},
        {'name': 'seconds', 'duration': 1, 'order': 0}
    ];

    function getGranularityFromName(granularityName) {
        for (var i = 0; i < GRANULARITIES.length; i++) {
            var granularity = GRANULARITIES[i];
            if (granularity.name === granularityName) {
                return granularity;
            }
        }

        assert(false, granularity);
    }

    // Returns a negative value if the first granularity is higher than the second, 0 if they are equal,
    // and a positive value if the second granularity is higher than the first.
    function compareGranularities(first, second) {
        return second.order - first.order;
    }

    function getJSON(url, data, success) {
        return $.ajax({
            'dataType': 'json',
            'url': url,
            'data': data,
            'success': success,
            // We don't use global jQuery Ajax setting to not conflict with some other code,
            // but we make sure we use traditional query params serialization for all our requests.
            'traditional': true
        });
    }

    function firstDefined(obj /*, args */) {
        for (var i = 1; i < arguments.length; i++) {
            if (!_.isUndefined(obj[arguments[i]])) {
                return obj[arguments[i]];
            }
        }
    }

    function getExtremeDatapoints(data) {
        // Maybe we have earliest_datapoint and latest_datapoint metadata.
        // earliest_datapoint and latest_datapoint are strings.
        var start = data.earliest_datapoint || null;
        var end = data.latest_datapoint || null;

        // Maybe we gave datapoints stream data.
        if (data.datapoints && data.datapoints.length > 0) {
            var firstDatapoint = data.datapoints[0];
            var lastDatapoint = data.datapoints[data.datapoints.length - 1];

            // We go through downsampled timestamps in such order to maximize the range
            var datapointsStart = _.isObject(firstDatapoint.t) ? firstDefined(firstDatapoint.t, 'a', 'e', 'm', 'z') : firstDatapoint.t;
            var datapointsEnd = _.isObject(lastDatapoint.t) ? firstDefined(lastDatapoint.t, 'z', 'm', 'e', 'a') : lastDatapoint.t;

            if (start === null || (start && datapointsStart && moment.utc(datapointsStart).valueOf() < moment.utc(start).valueOf())) {
                // datapointsStart is a string.
                start = datapointsStart || null;
            }
            if (end === null || (end && datapointsEnd && moment.utc(datapointsEnd).valueOf() > moment.utc(end).valueOf())) {
                // datapointsEnd is a string.
                end = datapointsEnd || null;
            }
        }

        // start and end values are null, or milliseconds.
        return {
            'start': start && moment.utc(start).valueOf(),
            'end': end && moment.utc(end).valueOf()
        }
    }

    function setsEqual(a, b) {
        return (a === b) || (a && b && a.length === b.length && _.difference(a, b).length === 0);
    }

    // We prefix all dynamic properties with _ to differentiate them from JSON data.
    // We use camelCase for dynamic properties, despite JSON data is using underscore_to_separate_words.
    function Stream(stream, streamManager) {
        var self = this;

        _.extend(self, stream);

        self._streamManager = streamManager;

        // It will be populated later on by the stream manager. Once all stream metadata is read.
        self._chart = null;

        if (_.without(self.tags.visualization.time_downsamplers, 'mean').length) {
            // TODO: Currently we support only mean time downsampler.
            console.error("Unsupported time downsamplers", self.tags.visualization.time_downsamplers);
            throw new Error("Unsupported time downsamplers");
        }

        if (_.without(self.tags.visualization.value_downsamplers, 'min', 'mean', 'max').length) {
            // TODO: Currently we support only min, mean, and max value downsampler.
            console.error("Unsupported value downsamplers", self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported value downsamplers");
        }

        self._mainTypes = [];
        self._rangeTypes = [];

        if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'max'])) {
            self._mainTypes = [{'type': 'arearange', 'keys': ['l', 'u']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean', 'max'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self._rangeTypes = [{'type': 'arearange', 'keys': ['l', 'u']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['mean', 'max'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self._rangeTypes = [{'type': 'arearange', 'keys': ['m', 'u']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self._rangeTypes = [{'type': 'arearange', 'keys': ['l', 'm']}];
        }
        // If no other line type matched, then we just use the mean value.
        else if (self.tags.visualization.type === 'line' && _.contains(self.tags.visualization.value_downsamplers, 'mean')) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m']}];
        }
        // For the stack type we use only the mean value.
        // TODO: How to visualize min and max?
        else if (self.tags.visualization.type === 'stack' && _.contains(self.tags.visualization.value_downsamplers, 'mean')) {
            // areaspline type is currently used only in the stacking mode, so its stacking mode is enabled for all charts.
            self._mainTypes = [{'type': 'areaspline', 'keys': ['m']}];
        }
        else {
            // TODO: Currently we have only limited support for various combinations.
            console.error("Unsupported combination of type and value downsamplers", self.tags.visualization.type, self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported combination of type and value downsamplers");
        }

        self._extremes = getExtremeDatapoints(self);
    }

    Stream.prototype.isWith = function (other) {
        var self = this;

        if (!self.tags.visualization.with) return false;

        // TODO: Should we use _.findWhere?
        if (!_.isEqual(_.pick(other.tags, _.keys(self.tags.visualization.with)), self.tags.visualization.with)) return false;

        if (self.tags.visualization.minimum !== other.tags.visualization.minimum || self.tags.visualization.maximum !== other.tags.visualization.maximum || self.tags.visualization.unit !== other.tags.visualization.unit) {
            console.warn("Streams matched, but incompatible Y axis", self, other);
            return false;
        }

        return true;
    };

    Stream.prototype.valueDownsamplers = function (initial) {
        var self = this;

        return _.union(self.tags.visualization.value_downsamplers, initial ? ['mean'] : [])
    };

    Stream.prototype.timeDownsamplers = function (initial) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now.
        //return _.union(self.tags.visualization.time_downsamplers, initial ? ['first', 'last'] : [])
        return _.union(['mean'], initial ? ['first', 'last'] : [])
    };

    Stream.prototype.computeRange = function (start, end) {
        var self = this;

        var range = {
            'granularity': GRANULARITIES[0]
        };

        if (!_.isNumber(start) || !_.isNumber(start)) {
            return range;
        }

        // In JavaScript timestamps are in milliseconds, but server sides uses them in seconds.
        range.start = start / 1000;
        range.end = end / 1000;

        var interval = range.end - range.start;

        for (var i = 0; i < GRANULARITIES.length; i++) {
            var granularity = GRANULARITIES[i];
            if (interval / granularity.duration > MAX_POINTS_NUMBER) {
                break;
            }
            range.granularity = granularity;
            if (granularity.name === self.highest_granularity) {
                break;
            }
        }

        // We enlarge range for 10 % in each direction
        range.start -= interval * 0.1;
        range.end += interval * 0.1;

        range.start = parseInt(Math.floor(range.start));
        range.end = parseInt(Math.ceil(range.end));

        return range;
    };

    // TODO: We should probably optimize this and not use functions to iterate.
    // TODO: Should we use web workers?
    Stream.prototype.convertDatapoint = function (datapoint) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now.
        var t = moment.utc(_.isObject(datapoint.t) ? datapoint.t.m : datapoint.t).valueOf();

        if (_.isObject(datapoint.v)) {
            return {
                'main': _.map(self._mainTypes, function (mainType, i) {
                    return [t].concat(_.map(mainType.keys, function (key, j) {return parseFloat(datapoint.v[key]);}));
                }),
                'range': _.map(self._rangeTypes, function (rangeType, i) {
                    return [t].concat(_.map(rangeType.keys, function (key, j) {return parseFloat(datapoint.v[key]);}));
                })
            }
        }
        else {
            return {
                'main': [[t].concat(_.map(self._mainTypes[0].keys, function (key, i) {return parseFloat(datapoint.v);}))],
                'range': []
            }
        }
    };

    // TODO: We should probably optimize this and not use functions to iterate.
    // TODO: Should we use web workers?
    Stream.prototype.convertDatapoints = function (datapoints) {
        var self = this;

        var main = _.map(self._mainTypes, function (mainType, i) {return [];});
        var range = _.map(self._rangeTypes, function (rangeType, i) {return [];});

        for (var i = 0; i < datapoints.length; i++) {
            var datapoint = self.convertDatapoint(datapoints[i]);

            for (var j = 0; j < datapoint.main.length; j++) {
                main[j].push(datapoint.main[j]);
            }
            for (var j = 0; j < datapoint.range.length; j++) {
                range[j].push(datapoint.range[j]);
            }
        }

        return {
            'main': main,
            'range': range
        };
    };

    function Chart(streamManager) {
        var self = this;

        self.streamManager = streamManager;

        self.streams = {};
        self.yAxis = [];

        // It will be populated later on when initialized.
        self.highcharts = null;
    }

    Chart.prototype.addStream = function (stream) {
        var self = this;

        assert(!_.has(self.streams, stream.id));
        assert.strictEqual(stream._chart, null);

        self.streams[stream.id] = stream;
        stream._chart = self;
    };

    Chart.prototype.initialize = function (callback) {
        var self = this;

        // We use MAX_POINTS_NUMBER as min number here, because at the highest granularity this is probably OK. But to be sure we
        // do not want to make range larger that what we have data for. Granularity duration is in seconds, so we have to convert.
        var minRange = Math.min(self.streamManager.highestGranularity.duration * 1000 * MAX_POINTS_NUMBER, self.streamManager.extremes.end - self.streamManager.extremes.start);

        $('<div/>').addClass('chart').appendTo(self.streamManager.element).highcharts('StockChart', {
            'chart': {
                'zoomType': 'x',
                'borderRadius': 10
            },
            'credits': {
                'enabled': false
            },
            'navigator': {
                'enabled': true,
                'adaptToUpdatedData': false,
                'series': {
                    'id': 'navigator',
                    // We will add our own series on top of this one and leave this one empty.
                    'data': []
                },
                'yAxis': {
                    'showRects': false
                }
            },
            'scrollbar': {
                'enabled': true,
                'liveRedraw': false
            },
            'legend': {
                'enabled': true,
                'verticalAlign': 'bottom',
                'floating': false,
                'padding': 5
            },
            'rangeSelector': {
                'buttonTheme': {
                    'width': 50
                },
                'buttons': [
                    {
                        'type': 'day',
                        'count': 1,
                        'text': "day"
                    },
                    {
                        'type': 'week',
                        'count': 1,
                        'text': "week"
                    },
                    {
                        'type': 'month',
                        'count': 1,
                        'text': "month"
                    },
                    {
                        'type': 'year',
                        'count': 1,
                        'text': "year"
                    },
                    {
                        'type': 'all',
                        'text': "all"
                    }
                ],
                'selected': 4 // All.
            },
            'xAxis': {
                'id': 'x-axis',
                'events': {
                    'afterSetExtremes': function (event) {
                        self.afterSetExtremes(event);
                    }
                },
                'ordinal': false,
                'minRange': minRange
            },
            'yAxis': [],
            'plotOptions': {
                'series': {
                    'marker': {
                        'enabled': true,
                        'radius': 3
                    },
                    'dataGrouping': {
                        'enabled': false
                    }
                },
                // areaspline type is currently used only in the stacking mode, so its stacking mode is enabled for all charts.
                areaspline: {
                    stacking: 'normal'
                }
            },
            'series': []
        }, function (highcharts) {
            self.highcharts = highcharts;
            if (callback) callback();
        });
    };

    Chart.prototype.afterSetExtremes = function (event) {
        var self = this;

        if (event.reason) {
            // It is our event.
            if (event.reason === 'initial') {
                // Extremes were changed as part of initial loading. We simply ignore this afterSetExtremes event.
            }
            else if (event.reason === 'syncing') {
                // Extremes were changed as part of syncing after a change. We have to potentially
                // update the datapoints with different range and granularity.
                self.renderNewViewport(event.min, event.max);
            }
            else {
                assert(false, event.reason);
            }
        }
        else {
            // User changed extremes. Visually the current chart has been redrawn with existing data, but now
            // let's load data for potentially new granularity and range in all charts, including this one.
            self.streamManager.setViewport(event.min, event.max);
        }
    };

    Chart.prototype.loadData = function (start, end, initial, callback) {
        var self = this;

        self.highcharts.showLoading("Loading data from server...");

        async.map(_.values(self.streams), function (stream, callback) {
            var range = stream.computeRange(start, end);

            // TODO: Possibly don't do anything if parameters have not changed from the previous data?

            getJSON(stream.resource_uri, {
                'granularity': range.granularity.name,
                'limit': MAX_POINTS_LOAD_LIMIT,
                'start': range.start,
                'end': range.end,
                'value_downsamplers': stream.valueDownsamplers(initial),
                'time_downsamplers': stream.timeDownsamplers(initial)
            }, function (data, textStatus, jqXHR) {
                var datapoints = stream.convertDatapoints(data.datapoints);

                // Add a reference to the stream.
                datapoints.stream = stream;

                callback(null, datapoints);
            }).fail(function () {
                callback(arguments);
            });
        }, function (error, results) {
            self.highcharts.hideLoading();

            callback(error, results);
        });
    };

    Chart.prototype.getYAxisTitle = function (stream) {
        return [stream.tags.unit_description || "", stream.tags.unit ? "[" + stream.tags.unit + "]" : ""].join(" ");
    };

    Chart.prototype.getYAxis = function (stream) {
        var self = this;

        var title = self.getYAxisTitle(stream);

        return self.highcharts.get('y-axis-' + title);
    };

    Chart.prototype.createYAxis = function (datapoints) {
        var self = this;

        var units = {};

        _.each(datapoints, function (streamDatapoints, i) {
            var stream = streamDatapoints.stream;

            var title = self.getYAxisTitle(stream);

            if (!units[title]) {
                units[title] = {
                    'min': stream.tags.visualization.minimum,
                    'max': stream.tags.visualization.maximum
                }
            }
            else {
                // We use == and not === to allow both null and undefined.

                if (units[title].min != null) {
                    if (stream.tags.visualization.minimum == null) {
                        units[title].min = null;
                    }
                    else if (stream.tags.visualization.minimum < units[title].min) {
                        units[title].min = stream.tags.visualization.minimum;
                    }
                }

                if (units[title].max != null) {
                    if (stream.tags.visualization.maximum == null) {
                        units[title].max = null;
                    }
                    else if (stream.tags.visualization.maximum < units[title].max) {
                        units[title].max = stream.tags.visualization.maximum;
                    }
                }
            }
        });

        for (var title in units) {
            if (!units.hasOwnProperty(title)) continue;

            var minMax = units[title];

            self.highcharts.addAxis({
                'id': 'y-axis-' + title,
                'title': {
                    'text': title
                },
                'showEmpty': false,
                'min': minMax.min,
                'max': minMax.max,
                'showRects': true,
                'showRectsX': -17,
                'showRectsY': 5
            });
        }
    };

    Chart.prototype.renderInitialData = function (callback) {
        var self = this;

        self.loadData(self.streamManager.extremes.start, self.streamManager.extremes.end, true, function (error, datapoints) {
            if (error) {
                callback(error);
                return;
            }

            self.createYAxis(datapoints);

            _.each(datapoints, function (streamDatapoints, i) {
                var stream = streamDatapoints.stream;

                var yAxis = self.getYAxis(stream);

                // The first series which was already added. If null, the current series being added is the first one.
                var firstSeries = null;

                // TODO: We should probably deduplicate code here.
                _.each(stream._rangeTypes, function (rangeType, j) {
                    var s = self.highcharts.addSeries({
                        'id': 'range-' + j + '-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'name': stream.tags.title,
                        'linkedTo': firstSeries ? firstSeries.options.id : undefined, // Has to be undefined and cannot be null.
                        'yAxis': yAxis.options.id,
                        'type': rangeType.type,
                        'color': firstSeries ? firstSeries.color : null, // To automatically choose a color.
                        'showRects': firstSeries ? false : true, // We want rect to be shown only for the first series (so that each color is shown only once).
                        'lineWidth': 0,
                        'fillOpacity': 0.3,
                        'tooltip': {
                            // TODO: Should be based on rangeType.
                            'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>',
                            'valueDecimals': 3
                        },
                        'visible': !stream.tags.visualization.hidden,
                        'data': streamDatapoints.range[j]
                    });
                    firstSeries = firstSeries || s;
                });
                _.each(stream._mainTypes, function (mainType, j) {
                    var s = self.highcharts.addSeries({
                        'id': 'main-' + j + '-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'name': stream.tags.title,
                        'linkedTo': firstSeries ? firstSeries.options.id : undefined, // Has to be undefined and cannot be null.
                        'yAxis': yAxis.options.id,
                        'type': mainType.type,
                        'color': firstSeries ? firstSeries.color : null, // To automatically choose a color.
                        'showRects': firstSeries ? false : true, // We want rect to be shown only for the first series (so that each color is shown only once).
                        'tooltip': {
                            // TODO: Should be based on mainType.
                            'pointFormat': '<span style="color:{series.color}">{series.name} mean</span>: <b>{point.y}</b><br/>',
                            'valueDecimals': 3
                        },
                        'visible': !stream.tags.visualization.hidden,
                        'data': streamDatapoints.main[j]
                    });
                    firstSeries = firstSeries || s;
                });
                var navigator = self.highcharts.get('navigator');
                self.highcharts.addAxis(_.extend({}, navigator.yAxis.options, {
                    'id': 'navigator-y-axis-' + stream.id
                }));
                self.highcharts.addSeries(_.extend({}, navigator.options, {
                    'id': 'navigator-' + stream.id,
                    'streamId': stream.id, // Our own option.
                    'yAxis': 'navigator-y-axis-' + stream.id,
                    'color': firstSeries.color,
                    'data': streamDatapoints.main[0] || streamDatapoints.range[0]
                }));
            });

            // Without the following range selector is not displayed until first zooming.
            self.highcharts.xAxis[0].setExtremes(self.streamManager.extremes.start, self.streamManager.extremes.end, true, false, {'reason': 'initial'});
        });
    };

    Chart.prototype.renderNewViewport = function (start, end) {
        var self = this;

        self.loadData(start, end, false, function (error, datapoints) {
            if (error) {
                console.error("Error loading data for new viewport", error);
                return;
            }

            for (var i = 0; i < datapoints.length; i++) {
                var streamDatapoints = datapoints[i];
                var stream = streamDatapoints.stream;

                for (var j = 0; j < stream._mainTypes.length; j++) {
                    self.highcharts.get('main-' + j + '-' + stream.id).setData(streamDatapoints.main[j], false);
                }
                for (var j = 0; j < stream._rangeTypes.length; j++) {
                    self.highcharts.get('range-' + j + '-' + stream.id).setData(streamDatapoints.range[j], false);
                }
            }

            self.highcharts.redraw(true);
        });
    };

    function StreamManager(element, options) {
        var self = this;

        self.element = element;
        self.options = options;
        self.streams = {};
        self.charts = [];
        self.extremes = null;
        self.highestGranularity = null;
    }

    StreamManager.prototype.start = function () {
        var self = this;

        var nextUri = self.options.streamListUri;
        var nextParams = self.options.streamListParams;
        // Handle pagination.
        async.whilst(function () {
            return !!nextUri;
        }, function (callback) {
            getJSON(nextUri, nextParams, function (data, textStatus, jqXHR) {
                _.each(data.objects, function (stream, i) {
                    self.newStream(stream);
                });

                nextUri = data.meta.next;
                // All params are already in "next".
                nextParams = {};
                callback();
            }).fail(function (/* args */) {
                callback(arguments);
            });
        }, function (error) {
            if (error) {
                // Do nothing, Ajax errors should be handled globally.
                return;
            }

            self.streamsLoaded();
        });
    };

    StreamManager.prototype.newStream = function (stream) {
        var self = this;

        assert(!_.has(self.streams, stream.id));

        // Sanity check. Streams to visualize should have visualization metadata.
        if (!(stream.tags && stream.tags.visualization)) {
            return;
        }

        try {
            var streamObject = new Stream(stream, self);
            self.streams[stream.id] = streamObject;
        }
        catch (error) {
            console.error("Stream '" + stream.id + "' creation error", error);
            return;
        }

        if (self.extremes) {
            if (streamObject._extremes.start !== null && streamObject._extremes.start < self.extremes.start) {
                self.extremes.start = streamObject._extremes.start;
            }
            if (streamObject._extremes.end !== null && streamObject._extremes.end > self.extremes.end) {
                self.extremes.end = streamObject._extremes.end;
            }
        }
        else {
            self.extremes = _.clone(streamObject._extremes);
        }

        if (self.highestGranularity) {
            var granularity = getGranularityFromName(streamObject.highest_granularity);
            if (compareGranularities(granularity, self.highestGranularity) < 0) {
                self.highestGranularity = granularity;
            }
        }
        else {
            self.highestGranularity = getGranularityFromName(streamObject.highest_granularity);
        }
    };

    // Streams can be declared to be with some other stream and should be displayed together.
    // This method finds a chart with a given stream, or a chart where at least one of existing
    // streams is declared to be with the a given stream (or vice-versa).
    StreamManager.prototype.getChart = function (stream) {
        var self = this;

        for (var i = 0; i < self.charts.length; i++) {
            var chart = self.charts[i];

            for (var chartStreamId in chart.streams) {
                if (!chart.streams.hasOwnProperty(chartStreamId)) continue;

                var chartStream = chart.streams[chartStreamId];

                assert.strictEqual(chartStream.id, chartStreamId);

                if (chartStream.id === stream.id) {
                    return chart;
                }

                if (chartStream.isWith(stream) || stream.isWith(chartStream)) {
                    return chart;
                }
            }
        }

        return null;
    };

    StreamManager.prototype.streamsLoaded  = function () {
        var self = this;


        for (var streamId in self.streams) {
            if (!self.streams.hasOwnProperty(streamId)) continue;

            var stream = self.streams[streamId];
            var chart = self.getChart(stream);

            if (!chart) {
                chart = new Chart(self);
                self.charts.push(chart);
            }

            chart.addStream(stream);
        }

        // Removes existing content (like loading message).
        $(self.element).empty();

        // Initializes all charts.
        async.each(self.charts, function (chart, callback) {
            chart.initialize(callback);
        }, function (error) {
            if (error) {
                console.error("Error initializing charts", error);
                return;
            }

            // We first initialize all, then then start rendering, so that visual space for all graphs
            // is reserved as soon as possible, so that things do not jump around too much anymore.
            async.each(self.charts, function (chart, callback) {
                chart.renderInitialData(callback);
            }, function (error) {
                if (error) {
                    console.error("Error rendering initial data", error);
                    return;
                }
            });
        });
    };

    // start and end arguments are in milliseconds.
    StreamManager.prototype.setViewport = function (start, end) {
        var self = this;

        // We use == and not === to test for both null and undefined.
        if (start == null || end == null) {
            return;
        }

        _.each(self.charts, function (chart, i) {
            chart.highcharts.get('x-axis').setExtremes(start, end, true, false, {'reason': 'syncing'});
        });
    };

	$.fn.datastream = function (options) {
        var self = this;

        if (!$.isReady) {
            console.error("Use of datastream before DOM was ready");
            return self;
        }
        options = $.extend(true, {}, $.fn.datastream.defaults, options);

        if (self.length === 0) {
            console.warn("Use of datastream on an empty group of elements");
            return self;
        }

        self.each(function (i, element) {
            new StreamManager(element, options).start();
        });

        return self;
    };

    $.fn.datastream.defaults = {
        'streamListUri': '/api/v1/stream/',
        'streamListParams': {}
    };

})(jQuery);
