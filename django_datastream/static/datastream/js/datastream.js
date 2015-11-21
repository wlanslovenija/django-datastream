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
                    _.each(['group', 'markerGroup', 'yaxisRect'], function (group, j) {
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

                    _.each(['group', 'markerGroup', 'yaxisRect'], function (group, j) {
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

    /*
     * Extend Highcharts so that JSON can be exported for the current viewport.
     */
    (function (Highcharts) {
        var defaultOptions = Highcharts.getOptions();

        _.extend(defaultOptions.lang, {
            'downloadJSON': "Download JSON data"
        });

        defaultOptions.exporting.buttons.contextButton.menuItems.push({
            'textKey': 'downloadJSON',
            'onclick': function (e) {
                this.downloadJSON();
            }
        });

        _.extend(defaultOptions.navigation.menuItemStyle, {
            'textDecoration': 'none'
        });

        Highcharts.wrap(Highcharts.Chart.prototype, 'contextMenu', function (proceed, className, items, x, y, width, height, button) {
            var chart = this;
            var datapoints = chart.latestDatapoints;

            if (datapoints) {
                // So that we do not modify the global array of items.
                items = _.clone(items);

                items.push({
                    'separator': true
                });

                _.each(datapoints, function (streamDatapoints, i) {
                    var stream = streamDatapoints.stream;
                    var jqXHR = streamDatapoints.jqXHR;

                    items.push({
                        'text': stream.tags.title,
                        'onclick': function (e) {
                            var url = jqXHR.requestUrl;
                            url += (REQUEST_QUERY.test(url) ? '&' : '?') + 'format=json';

                            var link = document.createElement('a');
                            link.href = url;
                            link.target = '_blank';
                            link.click();
                        }
                    });
                });
            }

            proceed.call(chart, className, items, x, y, width, height, button);
        });

        $.extend(Highcharts.Chart.prototype, {
            'downloadJSON': function () {
                var chart = this;

                var datapoints = chart.latestDatapoints || [];

                // We generate an array of all JSON responses for all streams for this chart.
                var result = [];

                for (var i = 0; i < datapoints.length; i++) {
                    var streamDatapoints = datapoints[i];
                    var jqXHR = streamDatapoints.jqXHR;
                    result.push(jqXHR.responseJSON);
                }

                // Using HTML5 download attribute and data url to export.
                var exportLink = document.createElement('a');
                exportLink.href = 'data:attachment/json,' + encodeURIComponent(JSON.stringify(result));
                exportLink.target = '_blank';
                exportLink.download = 'export.json';
                exportLink.click();
            }
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

    var REQUEST_QUERY = /\?/;

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

    // We cache made Ajax requests. This works even if the same requests are made in parallel.
    // TODO: Should we just leave caching to the browser?
    //       Should we just enable normal HTTP caching and then leave to the browser to cache and return same JSON content.
    //       This would make our codebase/logic easier. But does the browser caching address requests made in parallel?
    // TODO: We do not have any expiration mechanism.
    //       Again, this could simply be left to the HTTP caching. On the other side, with current datastream logic
    //       there should not be any need to expire loaded datapoints because they should not be changing.
    var ajaxRequests = {};

    function getJSON(url, data) {
        // We use traditional query params serialization for all our requests.
        var params = $.param(data, true);

        // We append params to the URL ourselves.
        url += (REQUEST_QUERY.test(url) ? '&' : '?') + params;

        if (!ajaxRequests[url]) {
            ajaxRequests[url] = $.ajax({
                'dataType': 'json',
                'url': url
            });

            // Store request URL so that it can be accessed in exporting menu.
            ajaxRequests[url].requestUrl = url;
        }

        return ajaxRequests[url];
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

        // If we did not have earliest_datapoint or latest_datapoint, maybe we have datapoints stream data and can reconstruct extremes.
        if ((start === null || end === null) && data.datapoints && data.datapoints.length > 0) {
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
    // Stream can be with multiple other streams, so the same stream object can be rendered multiple
    // times in multiple charts.
    function Stream(stream, streamManager) {
        var self = this;

        _.extend(self, stream);

        self._streamManager = streamManager;

        if (_.without(self.tags.visualization.time_downsamplers, 'mean').length) {
            // TODO: Currently we support only mean time downsampler.
            console.error("Unsupported time downsamplers", self.tags.visualization.time_downsamplers);
            throw new Error("Unsupported time downsamplers");
        }

        if (_.without(self.tags.visualization.value_downsamplers, 'min', 'mean', 'max', 'count').length) {
            // TODO: Currently we support only min, mean, max, and count value downsampler.
            console.error("Unsupported value downsamplers", self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported value downsamplers");
        }

        self._mainTypes = [];
        self._rangeTypes = [];
        self._flagTypes = [];

        if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'max'])) {
            self._mainTypes = [{'type': 'areasplinerange', 'keys': ['l', 'u'], 'parse': self.parseFloat}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean', 'max'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m'], 'parse': self.parseFloat}];
            self._rangeTypes = [{'type': 'areasplinerange', 'keys': ['l', 'u'], 'parse': self.parseFloat}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['mean', 'max'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m'], 'parse': self.parseFloat}];
            self._rangeTypes = [{'type': 'areasplinerange', 'keys': ['m', 'u'], 'parse': self.parseFloat}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean'])) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m'], 'parse': self.parseFloat}];
            self._rangeTypes = [{'type': 'areasplinerange', 'keys': ['l', 'm'], 'parse': self.parseFloat}];
        }
        // If no other line type matched, then we just use the mean value.
        else if (self.tags.visualization.type === 'line' && _.contains(self.tags.visualization.value_downsamplers, 'mean')) {
            self._mainTypes = [{'type': 'spline', 'keys': ['m'], 'parse': self.parseFloat}];
        }
        // For the stack type we use only the mean value.
        // TODO: How to visualize min and max?
        else if (self.tags.visualization.type === 'stack' && _.contains(self.tags.visualization.value_downsamplers, 'mean')) {
            // areaspline type is currently used only in the stacking mode, so its stacking mode is enabled for all charts.
            self._mainTypes = [{'type': 'areaspline', 'keys': ['m'], 'parse': self.parseFloat}];
        }
        else if (self.tags.visualization.type === 'event') {
            self._flagTypes = [{'type': 'flags', 'keys': ['c'], 'parse': self.parseEvent}];
        }
        else {
            // TODO: Currently we have only limited support for various combinations.
            console.error("Unsupported combination of type and value downsamplers", self.tags.visualization.type, self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported combination of type and value downsamplers");
        }

        self._extremes = getExtremeDatapoints(self);
    }

    // Caller makes sure that this is bound to the stream. For flag types, parsing function
    // is responsible to return an object representing the point from the raw datapoint value.
    Stream.prototype.parseEvent = function (datapointValue) {
        var self = this;

        if (_.isObject(datapointValue)) {
            datapointValue = datapointValue.c;
        }

        if (datapointValue == null || (!(datapointValue > 0))) {
            return null;
        }

        return {
            'title': self.tags.label,
            'text': self.tags.message
        }
    };

    // Caller makes sure that this is bound to the stream. Value is already extracted out of the possible object.
    Stream.prototype.parseFloat = function (value) {
        // If value is null or undefined we return null to represent a missing value.
        // Otherwise parseFloat converts it to NaN which is not processed as a missing value by Highcarts.
        if (value == null) {
            return null;
        }
        else {
            return parseFloat(value);
        }
    };

    Stream.prototype.isWith = function (other) {
        var self = this;

        // Stream is not "with" itself. This assures that in groupCharts if a stream is
        // already parts of a chart it is not returned.
        if (self.id === other.id) return false;

        if (!self.tags.visualization.with) return false;

        for (var withKey in self.tags.visualization.with) {
            if (!self.tags.visualization.with.hasOwnProperty(withKey)) continue;

            // All tags from "self.tags.visualization.with" have to exist and be equal in "other.tags".
            if (!_.isEqual(self.tags.visualization.with[withKey], other.tags[withKey])) {
                return false;
            }
        }

        // We can display events alongside any stream.
        if (self.tags.visualization.type === 'event' || other.tags.visualization.type === 'event') {
            return true;
        }

        if (self.tags.visualization.minimum !== other.tags.visualization.minimum || self.tags.visualization.maximum !== other.tags.visualization.maximum || self.tags.visualization.unit !== other.tags.visualization.unit) {
            console.warn("Streams matched, but incompatible Y axis", self, other);
            return false;
        }

        return true;
    };

    Stream.prototype.valueDownsamplers = function (initial) {
        var self = this;

        return _.union(self.tags.visualization.value_downsamplers, initial ? _.intersection(self.value_downsamplers, ['mean']) : [])
    };

    Stream.prototype.timeDownsamplers = function (initial) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now.
        //return self.tags.visualization.time_downsamplers;
        return ['mean'];
    };

    Stream.prototype.computeRange = function (start, end) {
        var self = this;

        assert(_.isNumber(start), start);
        assert(_.isNumber(end), end);

        var range = {
            'granularity': GRANULARITIES[0],
            // In JavaScript timestamps are in milliseconds, but server sides uses them in seconds.
            'start': start / 1000,
            'end': end / 1000
        };

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

        // If there are no known datapoints for the stream, we do not continue.
        // Using == on purpose.
        if (self._extremes.start == null || self._extremes.end == null) {
            range.start = null;
            range.end = null;
            return range;
        }

        // We enlarge range for 10 % in each direction, if possible.
        range.start -= interval * 0.1;
        range.start = Math.max(range.start, self._extremes.start / 1000);
        range.end += interval * 0.1;
        range.end = Math.min(range.end, self._extremes.end / 1000);

        // We round to the granularity intervals so that caching works better. Ranges which are just
        // slightly different and would still fall into the same granularity intervals and thus return
        // the same data, are here rounded so that we already internally use those granularity intervals.
        range.start = parseInt((Math.floor(range.start / granularity.duration) * granularity.duration), 10);
        range.end = parseInt((Math.ceil(range.end / granularity.duration) * granularity.duration), 10);

        return range;
    };

    // TODO: We should probably optimize this and not use functions to iterate.
    // TODO: Should we use web workers?
    // For flag types, parsing function is responsible to return an object representing the point from the rawdatapoint value.
    Stream.prototype.convertDatapoint = function (datapoint, main, range, flag) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now.
        var t = moment.utc(_.isObject(datapoint.t) ? datapoint.t.m : datapoint.t).valueOf();

        if (_.isObject(datapoint.v)) {
            _.each(self._mainTypes, function (mainType, i) {
                main[i].push([t].concat(_.map(mainType.keys, function (key, j) {return mainType.parse.call(self, datapoint.v[key]);})));
            });
            _.each(self._rangeTypes, function (rangeType, i) {
                range[i].push([t].concat(_.map(rangeType.keys, function (key, j) {return rangeType.parse.call(self, datapoint.v[key]);})));
            });
            _.each(self._flagTypes, function (flagType, i) {
                var value = flagType.parse.call(self, _.pick(datapoint.v, flagType.keys));
                // Using != on purpose.
                if (value != null) {
                    flag[i].push(_.extend({
                        'x': t
                    }, value));
                }
            });
        }
        else {
            _.each(self._mainTypes, function (mainType, i) {
                main[i].push([t].concat(_.map(mainType.keys, function (key, j) {return mainType.parse.call(self, datapoint.v);})));
            });
            _.each(self._flagTypes, function (flagType, i) {
                var value = flagType.parse.call(self, datapoint.v);
                // Using != on purpose.
                if (value != null) {
                    flag[i].push(_.extend({
                        'x': t
                    }, value));
                }
            });
        }
    };

    // TODO: We should probably optimize this and not use functions to iterate.
    // TODO: Should we use web workers?
    Stream.prototype.convertDatapoints = function (datapoints) {
        var self = this;

        var main = _.map(self._mainTypes, function (mainType, i) {return [];});
        var range = _.map(self._rangeTypes, function (rangeType, i) {return [];});
        var flag = _.map(self._flagTypes, function (flagType, i) {return [];});

        for (var i = 0; i < datapoints.length; i++) {
            self.convertDatapoint(datapoints[i], main, range, flag);
        }

        return {
            'main': main,
            'range': range,
            'flag': flag
        };
    };

    Stream.prototype.loadData = function (start, end, initial, callback) {
        var self = this;

        var range = self.computeRange(start, end);

        var parameters = {
            'granularity': range.granularity.name,
            'limit': MAX_POINTS_LOAD_LIMIT,
            'value_downsamplers': self.valueDownsamplers(initial),
            'time_downsamplers': self.timeDownsamplers(initial)
        };

        // Using != on purpose.
        if (range.start != null && range.end != null) {
            _.extend(parameters, {
                'start': range.start,
                'end': range.end
            });
        }

        getJSON(self.resource_uri, parameters).done(function (data, textStatus, jqXHR) {
            var datapoints = self.convertDatapoints(data.datapoints);

            // Add a reference to the stream and jqXHR object.
            datapoints.stream = self;
            datapoints.jqXHR = jqXHR;

            if (callback) callback(null, datapoints);
        }).fail(function (/* args */) {
            if (callback) callback(arguments);
        });
    };

    function Chart(streamManager) {
        var self = this;

        self.streamManager = streamManager;

        self.streams = {};

        // It will be populated later on when initialized.
        self.highcharts = null;
    }

    Chart.prototype.addStream = function (stream) {
        var self = this;

        assert(!_.has(self.streams, stream.id));

        self.streams[stream.id] = stream;
    };

    Chart.prototype.initialize = function (callback) {
        var self = this;

        // We use MAX_POINTS_NUMBER as min number here, because at the highest granularity this is probably OK. But to be sure we
        // do not want to make range larger that what we have data for. Granularity duration is in seconds, so we have to convert.
        var minRange = Math.min(self.streamManager.highestGranularity.duration * 1000 * MAX_POINTS_NUMBER, self.streamManager.extremes.end - self.streamManager.extremes.start);

        new Highcharts.StockChart({
            'chart': {
                'zoomType': 'x',
                'borderRadius': 10,
                'renderTo': $('<div/>').addClass('chart').appendTo(self.streamManager.element).get(0)
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
                    'showRects': false,
                    // We put y-axis of navigator, flags and other seris into into different panes. We put the initial
                    // (unused) navigator y-axis into a separate pane (pane 0) than other later navigator y-axis (pane 1)
                    // because in some cases putting all in the same pane made main y-axis too large for the data.
                    // See https://github.com/highslide-software/highcharts.com/issues/4523
                    'pane': 0,
                    'maxPadding': 0,
                    'minPadding': 0
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
            'tooltip': {
                'valueDecimals': 2,
                'shared': true
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
                'areaspline': {
                    'stacking': 'normal'
                }
            },
            'series': []
        }, function (highcharts) {
            // When exporting, charts are recreated by Highcharts. We do not do anything here.
            if (highcharts.options.chart.forExport) {
                return;
            }
            else {
                self.highcharts = highcharts;

                var $container = $(self.highcharts.container);
                highcharts.options.exporting.sourceWidth = $container.outerWidth();
                highcharts.options.exporting.sourceHeight = $container.outerHeight();

                if (callback) callback();
            }
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
            self.streamManager.setViewport(event.min, event.max, self);
        }
    };

    Chart.prototype.loadData = function (start, end, initial, callback) {
        var self = this;

        self.highcharts.showLoading("Loading data from server...");

        async.map(_.values(self.streams), function (stream, callback) {
            stream.loadData(start, end, initial, callback);
        }, function (error, results) {
            self.highcharts.hideLoading();

            if (callback) callback(error, results);
        });
    };

    Chart.prototype.getYAxisTitle = function (stream) {
        var title = [];

        // Event streams do not have units, but labels.
        if (stream.tags.visualization.type === 'event') {
            // We do not really display the title, but we prefix it so that it does not match any other title by accident.
            return 'Event: ' + stream.tags.label;
        }

        if (stream.tags.unit_description) {
            title.push(stream.tags.unit_description);
        }

        if (stream.tags.unit) {
            title.push("[" + stream.tags.unit + "]");
        }

        return title.join(" ");
    };

    Chart.prototype.getYAxis = function (stream) {
        var self = this;

        var title = self.getYAxisTitle(stream);

        return self.highcharts.get('y-axis-' + title);
    };

    // Does not redraw the chart. Caller should redraw.
    Chart.prototype.createYAxis = function (datapoints) {
        var self = this;

        var units = {};

        _.each(datapoints, function (streamDatapoints, i) {
            var stream = streamDatapoints.stream;

            var title = self.getYAxisTitle(stream);

            if (!units[title]) {
                units[title] = {
                    'min': stream.tags.visualization.minimum,
                    'max': stream.tags.visualization.maximum,
                    'event': stream.tags.visualization.type === 'event'
                }
            }
            else if (units[title].event) {
                // Event "units" can be only for streams which are all events.
                assert.equal(stream.tags.visualization.type, 'event');

                // We do not do any other processinr for event "units".
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

            var unit = units[title];

            if (unit.event) {
                self.highcharts.addAxis({
                    'id': 'y-axis-' + title,
                    'showRects': false,
                    // Do not show the axis itself. We need it only for series for flags to have correct position.
                    'labels': {
                        'enabled': false
                    },
                    'title': {
                        'text': null
                    },
                    // We put y-axis of navigator, flags and other seris into into different panes.
                    // See https://github.com/highslide-software/highcharts.com/issues/4523
                    'pane': 3
                // Do not redraw.
                }, false, false);
            }
            else {
                self.highcharts.addAxis({
                    'id': 'y-axis-' + title,
                    'title': {
                        'text': title
                    },
                    'minPadding': 0,
                    'maxPadding': 0,
                    'showEmpty': false,
                    'min': unit.min,
                    'max': unit.max,
                    'showRects': true,
                    'showRectsX': -15,
                    'showRectsY': 5,
                    // We put y-axis of navigator, flags and other seris into into different panes.
                    // See https://github.com/highslide-software/highcharts.com/issues/4523
                    'pane': 2
                // Do not redraw.
                }, false, false);
            }
        }
    };

    Chart.prototype.renderInitialData = function (callback) {
        var self = this;

        self.loadData(self.streamManager.extremes.start, self.streamManager.extremes.end, true, function (error, datapoints) {
            if (error) {
                if (callback) callback(error);
                return;
            }

            // Store datapoints array so that we can access it in the JSON exporting operation.
            self.highcharts.latestDatapoints = datapoints;

            self.createYAxis(datapoints);

            _.each(datapoints, function (streamDatapoints, i) {
                var stream = streamDatapoints.stream;

                // We have an assumption that y-axis will be used for or range and main type, or for flag type, but not for both.
                // This is because we are setting y-axis for a flag type into a different pane.
                assert((stream._rangeTypes.length + stream._mainTypes.length) === 0 || ((stream._rangeTypes.length + stream._mainTypes.length) > 0 && stream._flagTypes.length === 0));

                var yAxis = self.getYAxis(stream);

                // The first series which was already added. If null, the current series being added is the first one.
                var firstSeries = null;

                // TODO: We should probably deduplicate code here.
                _.each(stream._rangeTypes, function (rangeType, j) {
                    var s = self.highcharts.addSeries({
                        'id': 'range-' + j + '-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'name': stream.tags.title,
                        'linkedTo': firstSeries ? firstSeries.options.id : null,
                        'yAxis': yAxis.options.id,
                        'type': rangeType.type,
                        'color': firstSeries ? firstSeries.color : null, // To automatically choose a color.
                        'showRects': firstSeries ? false : true, // We want rect to be shown only for the first series (so that each color is shown only once).
                        'lineWidth': 0,
                        'fillOpacity': 0.3,
                        'tooltip': {
                            // TODO: Should be based on rangeType.
                            'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>'
                        },
                        'visible': !stream.tags.visualization.hidden,
                        'data': streamDatapoints.range[j]
                    // Do not redraw.
                    }, false);
                    firstSeries = firstSeries || s;
                });
                _.each(stream._mainTypes, function (mainType, j) {
                    var s = self.highcharts.addSeries({
                        'id': 'main-' + j + '-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'name': stream.tags.title,
                        'linkedTo': firstSeries ? firstSeries.options.id : null,
                        'yAxis': yAxis.options.id,
                        'type': mainType.type,
                        'color': firstSeries ? firstSeries.color : null, // To automatically choose a color.
                        'showRects': firstSeries ? false : true, // We want rect to be shown only for the first series (so that each color is shown only once).
                        'tooltip': {
                            // TODO: Should be based on mainType.
                            'pointFormat': '<span style="color:{series.color}">{series.name} mean</span>: <b>{point.y}</b><br/>'
                        },
                        'visible': !stream.tags.visualization.hidden,
                        'data': streamDatapoints.main[j]
                    // Do not redraw.
                    }, false);
                    firstSeries = firstSeries || s;
                });
                _.each(stream._flagTypes, function (flagType, j) {
                    // There is no way to toggle flags on and off, so we do not respect "hidden" tag.
                    var s = self.highcharts.addSeries({
                        'id': 'flag-' + j + '-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'name': stream.tags.title,
                        'linkedTo': firstSeries ? firstSeries.options.id : null,
                        'yAxis': yAxis.options.id,
                        'type': flagType.type,
                        'showInLegend': false,
                        'showRects': false,
                        'color': 'black', // We force it to black, so that other series automatic color choosing is not interfered with.
                        'shape': 'squarepin',
                        'zIndex': 100, // We want flags to always be over other series.
                        'data': streamDatapoints.flag[j]
                    // Do not redraw.
                    }, false);
                    firstSeries = firstSeries || s;
                });
                if (streamDatapoints.main[0] || streamDatapoints.range[0]) {
                    var navigatorData = streamDatapoints.main[0] || streamDatapoints.range[0];

                    // Prepending and appending null values so that all navigators for all charts have the same time span.
                    if (navigatorData.length) {
                        if (navigatorData[0][0] > self.streamManager.extremes.start) {
                            navigatorData = [[self.streamManager.extremes.start, null]].concat(navigatorData);
                        }

                        if (navigatorData[navigatorData.length - 1][0] < self.streamManager.extremes.end) {
                            navigatorData = navigatorData.concat([[self.streamManager.extremes.end, null]]);
                        }
                    }
                    else {
                        navigatorData = [[self.streamManager.extremes.start, null], [self.streamManager.extremes.end, null]];
                    }

                    var navigator = self.highcharts.get('navigator');
                    self.highcharts.addAxis(_.extend({}, navigator.yAxis.options, {
                        'id': 'navigator-y-axis-' + stream.id,
                        // We put y-axis of navigator, flags and other seris into into different panes. We put these
                        // navigator y-axis into pane 1 because in some cases putting all in the same pane made main
                        // y-axis too large for the data.
                        // See https://github.com/highslide-software/highcharts.com/issues/4523
                        'pane': 1
                    // Do not redraw.
                    }), false, false);
                    self.highcharts.addSeries(_.extend({}, navigator.options, {
                        'id': 'navigator-' + stream.id,
                        'streamId': stream.id, // Our own option.
                        'yAxis': 'navigator-y-axis-' + stream.id,
                        'color': firstSeries.color,
                        'data': navigatorData
                    // Do not redraw.
                    }), false);
                }
            });

            // Redraw. We set eventArgs so that it is passed to afterSetExtremes. It is similar to what happens if
            // you call chart.highcharts.get('x-axis').setExtremes(start, end, true, false, {'reason': 'initial'}).
            self.highcharts.get('x-axis').eventArgs = {'reason': 'initial'};
            self.highcharts.redraw(false);

            if (callback) callback();
        });
    };

    Chart.prototype.renderNewViewport = function (start, end) {
        var self = this;

        self.loadData(start, end, false, function (error, datapoints) {
            if (error) {
                console.error("Error loading data for new viewport", error);
                return;
            }

            // Store datapoints array so that we can access it in the JSON exporting operation.
            self.highcharts.latestDatapoints = datapoints;

            for (var i = 0; i < datapoints.length; i++) {
                var streamDatapoints = datapoints[i];
                var stream = streamDatapoints.stream;

                for (var j = 0; j < stream._mainTypes.length; j++) {
                    // Do not redraw.
                    self.highcharts.get('main-' + j + '-' + stream.id).setData(streamDatapoints.main[j], false);
                }
                for (var j = 0; j < stream._rangeTypes.length; j++) {
                    // Do not redraw.
                    self.highcharts.get('range-' + j + '-' + stream.id).setData(streamDatapoints.range[j], false);
                }
                for (var j = 0; j < stream._flagTypes.length; j++) {
                    // Do not redraw.
                    self.highcharts.get('flag-' + j + '-' + stream.id).setData(streamDatapoints.flag[j], false);
                }
            }

            // Redraw.
            self.highcharts.redraw(false);
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
            getJSON(nextUri, nextParams).done(function (data, textStatus, jqXHR) {
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
            // Using == on purpose.
            if (self.extremes.start == null || (streamObject._extremes.start != null && streamObject._extremes.start < self.extremes.start)) {
                self.extremes.start = streamObject._extremes.start;
            }
            if (self.extremes.end == null || (streamObject._extremes.end != null && streamObject._extremes.end > self.extremes.end)) {
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

    // Streams can be declared to be with some other streams and should be displayed together.
    // This method finds charts where at all of existing streams is declared to be with the given stream.
    // If a stream is already part of the chart, that chart is not returned.
    StreamManager.prototype.groupCharts = function (stream) {
        var self = this;

        return _.filter(self.charts, function (chart) {
            return _.every(chart.streams, function (chartStream, chartStreamId) {
                assert.strictEqual(chartStream.id, chartStreamId);

                return chartStream.isWith(stream) || stream.isWith(chartStream);
            })
        });
    };

    // Is a stream potentially with multiple other streams. Event streams are an example of streams which might be
    // declared to be displayed with multiple other streams, but other streams are not declared back.
    StreamManager.prototype.isWithMultiple = function (stream) {
        var self = this;

        for (var otherStreamId in self.streams) {
            if (!self.streams.hasOwnProperty(otherStreamId)) continue;

            var other = self.streams[otherStreamId];

            if (stream.id === other.id) continue;

            // If both streams are with each other, then this stream is OK.
            if (stream.isWith(other) && other.isWith(stream)) continue;

            // But if it is a one-sided "with", then return true. This stream is potentially with multiple other streams.
            if (stream.isWith(other)) return true;
        }

        return false;
    };

    // Create charts for streams which are not part of any existing chart.
    StreamManager.prototype.createChart = function (stream) {
        var self = this;

        // We do not create charts for streams which are with other streams, but they are not back with them. Those
        // are streams which are possibly with multiple other streams. So we skip them here and do not create
        // stand-alone charts for them as they will be added later on in groupStream method to existing charts.
        if (self.isWithMultiple(stream)) {
            return;
        }

        var charts = self.groupCharts(stream);

        if (charts.length) {
            // Stream should be in a group with an existing chart.
            return;
        }

        var chart = new Chart(self);
        self.charts.push(chart);
        chart.addStream(stream);
    };

    // Add streams to existing charts.
    StreamManager.prototype.groupStream = function (stream) {
        var self = this;

        // groupCharts does not return charts where stream is already part of the chart.
        var charts = self.groupCharts(stream);

        for (var i = 0; i < charts.length; i++) {
            charts[i].addStream(stream);
        }
    };

    StreamManager.prototype.streamsLoaded  = function () {
        var self = this;

        // First pass is to create charts for groups.
        for (var streamId in self.streams) {
            if (!self.streams.hasOwnProperty(streamId)) continue;

            var stream = self.streams[streamId];
            self.createChart(stream);
        }

        // Second pass is to add charts to all matching groups.
        for (var streamId in self.streams) {
            if (!self.streams.hasOwnProperty(streamId)) continue;

            var stream = self.streams[streamId];
            self.groupStream(stream);
        }

        // Removes existing content (like loading message).
        $(self.element).empty();

        // Initializes all charts.
        async.each(self.charts, function (chart, callback) {
            // Run it through the event loop to render UI updates in chunks and not only at the end of everything.
            setTimeout(function () {
                chart.initialize(callback);
            });
        }, function (error) {
            if (error) {
                console.error("Error initializing charts", error);
                return;
            }

            // We first initialize all, then then start rendering, so that visual space for all graphs
            // is reserved as soon as possible, so that things do not jump around too much anymore.
            async.each(self.charts, function (chart, callback) {
                // Run it through the event loop to render UI updates in chunks and not only at the end of everything.
                setTimeout(function () {
                    chart.renderInitialData(callback);
                });
            }, function (error) {
                if (error) {
                    console.error("Error rendering initial data", error);
                    return;
                }
            });
        });
    };

    // start and end arguments are in milliseconds.
    StreamManager.prototype.setViewport = function (start, end, originStream) {
        var self = this;

        // We use == and not === to test for both null and undefined.
        if (start == null || end == null) {
            return;
        }

        // Calling setExtremes on origin stream does not always work when start and end is the same as it was just
        // set (but we want to load new datapoints), so we skip it in the loop below and call renderNewViewport manually.
        setTimeout(function () {
            originStream.renderNewViewport(start, end);
        });

        _.each(self.charts, function (chart, i) {
            if (chart === originStream) {
                return;
            }

            // Run it through the event loop to render UI updates in chunks and not only at the end of everything.
            setTimeout(function () {
                chart.highcharts.get('x-axis').setExtremes(start, end, true, false, {'reason': 'syncing'});
            });
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

        var currentTimezoneOffset = Highcharts.getOptions().global.timezoneOffset;
        if (!_.isUndefined(currentTimezoneOffset) && currentTimezoneOffset !== options.timezoneOffset) {
            // TODO: Make it not global.
            //       See: https://highcharts.uservoice.com/forums/55896-highcharts-javascript-api/suggestions/10803462-timezone-specific-to-chart-not-global
            console.warn("Redefining timezone from '" + currentTimezoneOffset + "' to '" + options.timezoneOffset + "'");
        }

        Highcharts.setOptions({
            'global': {
                'timezoneOffset': options.timezoneOffset
            }
        });

        self.each(function (i, element) {
            new StreamManager(element, options).start();
        });

        return self;
    };

    $.fn.datastream.defaults = {
        'streamListUri': '/api/v1/stream/',
        'streamListParams': {},
        // Positive values are west, negative values are east of UTC, as in the ECMAScript getTimezoneOffset method.
        'timezoneOffset': 0
    };

})(jQuery);
