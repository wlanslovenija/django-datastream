(function ($) {

    _.mixin({
        'findIndex': function (obj, iterator, context) {
            var result = null;
            _.any(obj, function(value, index, list) {
                if (iterator.call(context, value, index, list)) {
                    result = index;
                    return true;
                }
            });
            return result;
        }
    });

    /**
     * Plugin for highlighting. It set a lower opacity for other series than the one that is hovered over.
     * Additionally, if not hovering over, a lower opacity is set based on series selected status.
     */
    (function (Highcharts) {
        function highlightOn(allSeries, currentSeries) {
            return function (e) {
                _.each(allSeries, function (series, i) {
                    if (i === 0) {
                        // We skip (empty) navigator series
                        assert.equal(series.data.length, 0);
                        return;
                    }

                    var current = series === currentSeries || series.linkedParent === currentSeries || series.options.streamId === currentSeries.options.streamId;
                    _.each(['group', 'markerGroup'], function (group, j) {
                        series[group].attr('opacity', current ? 1.0 : 0.25);
                    });
                    // We reuse visibility styles here
                    series.chart.legend.colorizeItem(series, current);
                });
            };
        }

        function highlightOff(allSeries, currentSeries) {
            return function (e) {
                _.each(allSeries, function (series, i) {
                    if (i === 0) {
                        // We skip (empty) navigator series
                        assert.equal(series.data.length, 0);
                        return;
                    }

                    assert(series.options.streamId);

                    var selected = series.selected || _.some(_.filter(allSeries, function (s) {return s.options.streamId === series.options.streamId}), function (s) {return s.selected});

                    _.each(['group', 'markerGroup'], function (group, j) {
                        series[group].attr('opacity', selected ? 1.0 : 0.25);
                    });
                    // We reuse visibility styles here
                    series.chart.legend.colorizeItem(series, selected);
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
     * Extend Highcharts so that JSON and XML can be exported from the current view.
     */
    (function (Highcharts) {
        var defaultOptions = Highcharts.getOptions();

        _.extend(defaultOptions.lang, {
            'exportJSON': "Export JSON",
            'exportXML': "Export XML"
        });

        defaultOptions.exporting.buttons.contextButton.menuItems.push({
            'separator': true
        },
        {
            'textKey': 'exportJSON',
            'onclick': function (e) {
                // We make a menu entry into a link, so we don't do anything here
            }
        },
        {
            'textKey': 'exportXML',
            'onclick': function (e) {
                // We make a menu entry into a link, so we don't do anything here
            }
        });

        _.extend(defaultOptions.navigation.menuItemStyle, {
            'textDecoration': 'none'
        });

        Highcharts.wrap(Highcharts.Chart.prototype, 'contextMenu', function (proceed, className, items, x, y, width, height, button) {
            proceed.call(this, className, items, x, y, width, height, button);

            var exportJSON = _.findIndex(this.options.exporting.buttons.contextButton.menuItems, function (menuItem) {
                return menuItem.textKey === 'exportJSON';
            });
            var exportXML = _.findIndex(this.options.exporting.buttons.contextButton.menuItems, function (menuItem) {
                return menuItem.textKey === 'exportXML';
            });

            var menuItemStyle = this.options.navigation.menuItemStyle;
            var menuItemHoverStyle = this.options.navigation.menuItemHoverStyle;

            // TODO: We remove padding here so that link does not have additional padding, but this prevents overriding with some other padding, we should probably use some other style object, with menuItemStyle as default
            menuItemStyle = _.omit(menuItemStyle, 'padding');

            var $exportJSON = $(this.exportDivElements[exportJSON]);
            var $exportXML = $(this.exportDivElements[exportXML]);

            function addFormat(url, format) {
                if (url.indexOf('?') !== -1) {
                    return url + '&format=' + format;
                }
                else {
                    return url + '?format=' + format;
                }
            }

            var exportJSONURL = addFormat(this.exportDataURL, 'json');
            var exportXMLURL = addFormat(this.exportDataURL, 'xml');

            function addLink($div, url) {
                if (!$div.find('a').attr('href', url).length) {
                    $div.wrapInner($('<a/>').attr('href', url).css(menuItemStyle).hover(function (e) {
                        $(this).css(menuItemHoverStyle);
                    }, function (e) {
                        $(this).css(menuItemStyle);
                    }));
                }
            }

            addLink($exportJSON, exportJSONURL);
            addLink($exportXML, exportXMLURL);
        });
    }(Highcharts));

    // TODO: This currently does not depend on how many datapoints are really available, so if granularity is seconds, it assumes that every second will have a datapoint
    // TODO: Should this depend on possible granularity for the stream(s)? Or some other hint?
    var MAX_POINTS_NUMBER = 300;
    // TODO: How much exactly do we want?
    var MAX_POINTS_LOAD_LIMIT = 1000;

    var GRANULARITIES = [
        {'name': 'days', 'duration': 24 * 60 * 60},
        {'name': '6hours', 'duration': 6 * 60 * 60},
        {'name': 'hours', 'duration': 60 * 60},
        {'name': '10minutes', 'duration': 10 * 60},
        {'name': 'minutes', 'duration': 60},
        {'name': '10seconds', 'duration': 10},
        {'name': 'seconds', 'duration': 1}
    ];

    function firstDefined(obj) {
        for (var i = 1; i < arguments.length; i++) {
            if (!_.isUndefined(obj[arguments[i]])) {
                return obj[arguments[i]];
            }
        }
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

    function getExtremeDatapoints(data) {
        // earliest_datapoint and latest_datapoint are strings.
        var start = data.earliest_datapoint || null;
        var end = data.latest_datapoint || null;

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

    function Stream(stream, streamList) {
        var self = this;

        _.extend(self, stream);

        self.streamList = streamList;

        if (_.without(self.tags.visualization.time_downsamplers, 'mean').length) {
            // TODO: Currently we support only mean time downsampler
            console.error("Unsupported time downsamplers", self.tags.visualization.time_downsamplers);
            throw new Error("Unsupported time downsamplers");
        }

        if (_.without(self.tags.visualization.value_downsamplers, 'min', 'mean', 'max').length) {
            // TODO: Currently we support only min, mean, and max value downsampler
            console.error("Unsupported value downsamplers", self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported value downsamplers");
        }

        self.minRange = null; // In milliseconds.
        self.maxRange = null; // In milliseconds.
        self.lastRangeStart = null; // In seconds.
        self.lastRangeEnd = null; // In seconds.

        self.mainTypes = [];
        self.rangeTypes = [];

        if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'max'])) {
            self.mainTypes = [{'type': 'spline', 'keys': ['u']}, {'type': 'spline', 'keys': ['l']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean', 'max'])) {
            self.mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self.rangeTypes = [{'type': 'arearange', 'keys': ['l', 'u']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['mean', 'max'])) {
            self.mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self.rangeTypes = [{'type': 'arearange', 'keys': ['m', 'u']}];
        }
        else if (self.tags.visualization.type === 'line' && setsEqual(self.tags.visualization.value_downsamplers, ['min', 'mean'])) {
            self.mainTypes = [{'type': 'spline', 'keys': ['m']}];
            self.rangeTypes = [{'type': 'arearange', 'keys': ['l', 'm']}];
        }
        else {
            // TODO: Currently we have only limited support for various combinations
            console.error("Unsupported combination of type and value downsamplers", self.tags.visualization.type, self.tags.visualization.value_downsamplers);
            throw new Error("Unsupported combination of type and value downsamplers");
        }

        assert(!_.has(self.streamList.streams, stream.id));

        self.streamList.streams[stream.id] = self;

        self.getChart(function () {
            self.loadInitialData();
        });
    }

    Stream.prototype.getChart = function (callback) {
        var self = this;

        var existing = self.streamList.isWith(self);
        if (existing) {
            self.chart = existing.chart;
            if (callback) callback();
        }
        else {
            self.initializeChart(callback);
        }
    };

    Stream.prototype.initializeChart = function (callback) {
        var self = this;

        // This chart can be reused between many streams so using "self"
        // in callbacks will make things work only for the first stream.
        // For example, "self.id" corresponds to the first stream.
        $('<div/>').addClass('chart').appendTo(self.streamList.element).highcharts('StockChart', {
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
                    // We will add our own series on top of this one and leave this one empty
                    'data': []
                }
            },
            'scrollbar': {
                'enabled': true,
                'liveRedraw': false
            },
            'legend': {
                'enabled': true,
                'verticalAlign': 'top',
                'floating': true,
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
                'selected': 4 // All
            },
            'xAxis': {
                'id': 'x-axis',
                'events': {
                    'afterSetExtremes': function (event) {
                        if (event.reason) {
                            // It is our event.
                            if (event.reason === 'user') {
                                // Use changed extremes, server list extremes were updated and now each chart
                                // has to update its series.
                                var streams = _.uniq(_.filter(_.map(self.chart.series, function (series, i) {
                                    return series.options.streamId;
                                }), function (series) {return !!series;}));
                                // We are using "path" as a list of of all streams loaded this time to prevent a
                                // "catch up" loop, where new and new loading requests find new datapoints, extend
                                // the range of stream list, and load again all, to discover new datapoints added
                                // in meantime. So we don't load any streams which are already in the "path".
                                streams = _.difference(streams, event.path);
                                self.streamList.loadData(event, streams);
                            }
                            else if (event.reason === 'initial') {
                                // Extremes were changed as part of initial loading. Extremes are made larger and
                                // larger as new streams are being added to the stream list. When loading initially
                                // each individual stream already loaded the largest range of datapoints for a given
                                // stream, so there is no reason to try to load datapoints with larger extremes.
                                // The same datapoints would be returned.
                                // The exception is if a new datapoint was added during the initialization process,
                                // but we choose to ignore it because already initialization loads a lot of data and
                                // additionally it could lead to "catch up" loop, where new and new requests find new
                                // datapoints, extend the range of stream list, and load again all, to discover new
                                // datapoints added in meantime. This is the same reason why we are storing the list
                                // of already loaded streams in "path".
                                // Additionally, the first stream loaded could be much shorter in overall time span than
                                // a later stream (the first stream maybe corresponding to a sensor added much later on
                                // while other streams are full of datapoints). Maybe even loaded at a higher granularity.
                                // After a later stream is added and stream list extremes became larger, loading the
                                // later stream at a lower granularity, it might be visually better to load the first
                                // stream at this lower granularity as well, instead of trying to squeeze the higher
                                // granularity to a now visually small area in the chart. We choose again to minimize
                                // loading during initialization.
                                // So, we simply ignore the afterSetExtremes event when reason is "initial".
                                // TODO: We should change the initial loading process to first go through all streams and make a plan how and what to load, to maximize looks of all streams, but minimize the amount of data that is loaded. Additionally, the number of redraws could be minimized, and also it should be possible to request that initially some other view is loaded, with data for that view, and not the same initial view (so URL could have the state of the view in its hash)
                            }
                            else {
                                assert(false, event.reason);
                            }
                        }
                        else {
                            // User changed extremes. Visually the current chart has
                            // been redrawn with existing data, but now let's load data
                            // for potentially new granularity and range in all charts,
                            // including this one. We start with empty path.
                            self.streamList.setExtremes(event, 'user', []);
                        }
                    }
                },
                'ordinal': false,
                'minRange': MAX_POINTS_NUMBER * 1000 // TODO: Should this depend on possible granularity for the stream(s)? Or some other hint?
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
                }
            },
            'series': []
        }, function (chart) {
            chart.loadingShown = 0;
            self.chart = chart;
            if (callback) callback();
        });
    };

    Stream.prototype.showLoading = function () {
        var self = this;

        assert(self.chart.loadingShown >= 0);

        self.chart.loadingShown++;
        if (self.chart.loadingShown === 1) {
            self.chart.showLoading("Loading data from server...");
        }
    };

    Stream.prototype.hideLoading = function () {
        var self = this;

        assert(self.chart.loadingShown > 0);

        self.chart.loadingShown--;
        if (self.chart.loadingShown === 0) {
            self.chart.hideLoading();
        }
    };

    // TODO: We should probably optimize this and not use functions to iterate
    Stream.prototype.convertDatapoint = function (datapoint) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now
        var t = moment.utc(_.isObject(datapoint.t) ? datapoint.t.m : datapoint.t).valueOf();

        if (_.isObject(datapoint.v)) {
            return {
                'main': _.map(self.mainTypes, function (mainType, i) {
                    return [t].concat(_.map(mainType.keys, function (key, j) {return parseFloat(datapoint.v[key]);}));
                }),
                'range': _.map(self.rangeTypes, function (rangeType, i) {
                    return [t].concat(_.map(rangeType.keys, function (key, j) {return parseFloat(datapoint.v[key]);}));
                })
            }
        }
        else {
            return {
                'main': [[t].concat(_.map(self.mainTypes[0].keys, function (key, i) {return parseFloat(datapoint.v);}))],
                'range': []
            }
        }
    };

    // TODO: We should probably optimize this and not use functions to iterate
    Stream.prototype.convertDatapoints = function (datapoints) {
        var self = this;

        var main = _.map(self.mainTypes, function (mainType, i) {return [];});
        var range = _.map(self.rangeTypes, function (rangeType, i) {return [];});

        _.each(datapoints, function (datapoint, i) {
            datapoint = self.convertDatapoint(datapoint);
            _.each(datapoint.main, function (m, i) {
                main[i].push(m);
            });
            _.each(datapoint.range, function (r, i) {
                range[i].push(r);
            });
        });

        return {
            'main': main,
            'range': range
        };
    };

    Stream.prototype.setExportDataURL = function (url) {
        var self = this;

        self.chart.exportDataURL = url;
    };

    Stream.prototype.loadInitialData = function () {
        var self = this;

        var min = null;
        var max = null;

        if (self.earliest_datapoint) {
            min = moment.utc(self.earliest_datapoint).valueOf();
        }
        if (self.latest_datapoint) {
            max = moment.utc(self.latest_datapoint).valueOf();
        }

        var range = self.computeRange(min, max);

        self.showLoading();
        getJSON(self.resource_uri, {
            // Use no time bounds to get initial data. We just want the
            // granularity which has suitable amount of datapoints.
            'granularity': range.granularity.name,
            'limit': MAX_POINTS_LOAD_LIMIT,
            'value_downsamplers': self.valueDownsamplers(true),
            'time_downsamplers': self.timeDownsamplers(true)
        }, function (data, textStatus, jqXHR) {
            assert.equal(data.id, self.id);

            var settings = this;

            var extremes = getExtremeDatapoints(data);

            // In JavaScript timestamps are in milliseconds, but last range values are in seconds.
            self.lastRangeStart = extremes.start / 1000;
            self.lastRangeEnd = extremes.end / 1000;

            var datapoints = self.convertDatapoints(data.datapoints);

            self.chart.addAxis({
                'id': 'y-axis-' + self.id,
                'title': {
                    'text': [self.tags.unit_description || "", self.tags.unit ? "[" + self.tags.unit + "]" : ""].join(" ")
                },
                'showEmpty': false,
                'min': self.tags.visualization.minimum,
                'max': self.tags.visualization.maximum
            });
            var yAxis = self.chart.get('y-axis-' + self.id);
            // TODO: We should probably deduplicate code here
            var series = null;
            _.each(self.rangeTypes, function (rangeType, i) {
                var s = self.chart.addSeries({
                    'id': 'range-' + i + '-' + self.id,
                    'streamId': self.id, // Our own option
                    'name': self.tags.title,
                    'linkedTo': series ? series.options.id : undefined, // Has to be undefined and cannot be null
                    'yAxis': yAxis.options.id,
                    'type': rangeType.type,
                    'color': series ? series.color : null, // To automatically choose a color
                    'lineWidth': 0,
                    'fillOpacity': 0.3,
                    'tooltip': {
                        // TODO: Should be based on rangeType
                        'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>',
                        'valueDecimals': 3
                    },
                    'selected': series ? false : true, // By default all streams in the legend are selected/highlighted
                    'events': {
                        'legendItemClick': series ? null : function (e) {
                            e.preventDefault();

                            this.select();

                            // We force mouse leave event to immediately set highlights
                            $(this.legendGroup.element).trigger('mouseleave.highlight');
                        }
                    },
                    'data': datapoints.range[i]
                });
                series = series || s;
                // Match yAxis title color with series color
                yAxis.axisTitle.css({'color': series.color});
            });
            _.each(self.mainTypes, function (mainType, i) {
                var s = self.chart.addSeries({
                    'id': 'main-' + i + '-' + self.id,
                    'streamId': self.id, // Our own option
                    'name': self.tags.title,
                    'linkedTo': series ? series.options.id : undefined, // Has to be undefined and cannot be null
                    'yAxis': yAxis.options.id,
                    'type': mainType.type,
                    'color': series ? series.color : null, // To automatically choose a color
                    'tooltip': {
                        // TODO: Should be based on mainType
                        'pointFormat': '<span style="color:{series.color}">{series.name} mean</span>: <b>{point.y}</b><br/>',
                        'valueDecimals': 3
                    },
                    'selected': series ? false : true, // By default all streams in the legend are selected/highlighted
                    'events': {
                        'legendItemClick': series ? null : function (e) {
                            e.preventDefault();

                            this.select();

                            // We force mouse leave event to immediately set highlights
                            $(this.legendGroup.element).trigger('mouseleave.highlight');
                        }
                    },
                    'data': datapoints.main[i]
                });
                series = series || s;
                // Match yAxis title color with series color
                yAxis.axisTitle.css({'color': series.color});
            });
            var navigator = self.chart.get('navigator');
            self.chart.addAxis(_.extend({}, navigator.yAxis.options, {
                'id': 'navigator-y-axis-' + self.id
            }));
            self.chart.addSeries(_.extend({}, navigator.options, {
                'id': 'navigator-' + self.id,
                'streamId': self.id, // Our own option
                'yAxis': 'navigator-y-axis-' + self.id,
                'color': series.color,
                'data': datapoints.main[0] || datapoints.range[0]
            }));

            // Without the following range selector is not displayed until first zooming.
            // Additionally, on streams which reuse existing graphs, we have to trigger
            // setExtremes event and loadData. So we call this every time a new stream
            // is added to a chart.
            // TODO: Why calling setExtremes on xAxis[0] is not idempotent operation but grows range just a bit?
            var eventPayload = {'reason': 'initial', 'path': [self.id]};
            // We are using long form of .setExtremes() so that we can pass eventPayload.
            // TODO: Do we have to redraw?
            self.chart.xAxis[0].setExtremes(null, null, true, false, eventPayload);

            self.updateKnownMaxRange(data, eventPayload);

            self.setExportDataURL(settings.url);
        }).always(function () {
            self.hideLoading();
        });
    };

    // Inputs are expected to be in milliseconds.
    Stream.prototype.computeRange = function (min, max) {
        var self = this;

        var range = {
            'granularity': GRANULARITIES[0]
        };

        if (!_.isNumber(min) || !_.isNumber(min)) {
            return range;
        }

        // In JavaScript timestamps are in milliseconds, but server sides uses them in seconds
        range.start = min / 1000;
        range.end = max / 1000;

        var interval = range.end - range.start;

        for (var i = 0; i < GRANULARITIES.length; i++) {
            var granularity = GRANULARITIES[i];
            if (interval / granularity.duration > MAX_POINTS_NUMBER) {
                break;
            }
            range.granularity = granularity;
        }

        // We enlarge range for 10 % in each direction
        range.start -= interval * 0.1;
        range.end += interval * 0.1;

        range.start = parseInt(Math.floor(range.start));
        range.end = parseInt(Math.ceil(range.end));

        return range;
    };

    Stream.prototype.valueDownsamplers = function (initial) {
        var self = this;

        return _.union(self.tags.visualization.value_downsamplers, initial ? ['mean'] : [])
    };

    Stream.prototype.timeDownsamplers = function (initial) {
        var self = this;

        // TODO: Currently really supporting only mean time downsampler, so let's hard-code it for now
        //return _.union(self.tags.visualization.time_downsamplers, initial ? ['first', 'last'] : [])
        return _.union(['mean'], initial ? ['first', 'last'] : [])
    };

    Stream.prototype.rangeDifference = function (a, b, granularity) {
        assert(_.isNumber(a));
        assert(_.isNumber(b));

        // If difference is so that it would add or remove at least
        // one datapoint at the given granularity, return true.
        return Math.abs((a - b) / granularity.duration) >= 1.0;
    };

    Stream.prototype.loadData = function (event) {
        var self = this;

        // We should not get here when loading initial data.
        assert.notEqual(event.reason, 'initial');

        // We should not get here with ourselves already in the path.
        assert(!_.contains(event.path, self.id));

        var range = self.computeRange(event.min, event.max);

        if (!self.rangeDifference(range.start, self.lastRangeStart, range.granularity) && !self.rangeDifference(range.end, self.lastRangeEnd, range.granularity)) {
            // Nothing really changed. Not enough for a datapoint to get into or out of the range at the given granularity.
            return;
        }

        // TODO: We should also return if range.start is before self.minRange and range.end is after self.maxRange, because there are probably no new datapoints there, but this would prevent slowly loading new datapoints if there are in fact added in meantime, but is this really the way we would want to load them, instead of streaming them in real-time for example?

        self.showLoading();
        getJSON(self.resource_uri, {
            'granularity': range.granularity.name,
            'limit': MAX_POINTS_LOAD_LIMIT,
            'start': range.start,
            'end': range.end,
            'value_downsamplers': self.valueDownsamplers(),
            'time_downsamplers': self.timeDownsamplers()
        }, function (data, textStatus, jqXHR) {
            assert.equal(data.id, self.id);

            var settings = this;

            self.lastRangeStart = range.start;
            self.lastRangeEnd = range.end;

            var datapoints = self.convertDatapoints(data.datapoints);
            _.each(self.mainTypes, function (mainType, i) {
                self.chart.get('main-' + i + '-' + self.id).setData(datapoints.main[i]);
            });
            _.each(self.rangeTypes, function (rangeType, i) {
                self.chart.get('range-' + i + '-' + self.id).setData(datapoints.range[i]);
            });

            self.hideLoading();

            self.updateKnownMaxRange(data, {'reason': event.reason, 'path': event.path.concat([self.id])});

            self.setExportDataURL(settings.url);
        }).fail(function () {
            self.hideLoading();
        });
    };

    Stream.prototype.updateKnownMaxRange = function (data, eventPayload) {
        var self = this;

        assert.equal(self.id, data.id);

        var extremes = getExtremeDatapoints(data);

        var changed = false;

        if (extremes.start !== null && (self.minRange === null || extremes.start < self.minRange)) {
            changed = true;
            self.minRange = extremes.start;
        }
        if (extremes.end !== null && (self.maxRange === null || extremes.end > self.maxRange)) {
            changed = true;
            self.maxRange = extremes.end;
        }

        if (changed && self.minRange !== null && self.maxRange !== null) {
            self.streamList.updateKnownMaxRange(self.id, self.minRange, self.maxRange, eventPayload);
        }
    };

    function StreamList(element, options) {
        var self = this;

        self.element = element;
        self.options = options;
        self.streams = {};
        self.minRange = null;
        self.maxRange = null;
    }

    StreamList.prototype.loadData = function (event, streams) {
        var self = this;

        var originalPath = event.path;
        try {
            _.each(_.pick(self.streams, streams), function (stream, id) {
                var currentStreams = _.without(streams, id);
                event.path = originalPath.concat(currentStreams);
                stream.loadData(event);
            });
        }
        finally {
            event.path = originalPath;
        }
    };

    StreamList.prototype.newStream = function (stream) {
        var self = this;

        assert(!_.has(self.streams, stream.id));

        if (stream.tags && stream.tags.visualization && !stream.tags.visualization.hidden) {
            try {
                new Stream(stream, self);
            }
            catch (e) {
                // We ignore the exception because we have already logged it
            }
        }
    };

    StreamList.prototype.setExtremes = function (event, reason, path) {
        var self = this;

        // We use == and not === to test for both null and undefined.
        if (event.min == null || event.max == null) return;

        self._setExtremes(event.min, event.max, 'x-axis', {'reason': reason, 'path': path});
    };

    StreamList.prototype._setExtremes = function (min, max, axis, eventPayload) {
        var self = this;

        var charts = _.uniq(_.pluck(_.values(self.streams), 'chart'));

        _.each(charts, function (chart, i) {
            chart.get(axis).setExtremes(min, max, true, false, eventPayload);
        });
    };

    StreamList.prototype.updateKnownMaxRange = function (streamId, minRange, maxRange, eventPayload) {
        var self = this;

        assert(_.has(self.streams, streamId));

        var changed = false;

        if (self.minRange === null || minRange < self.minRange) {
            changed = true;
            self.minRange = minRange;
        }
        if (self.maxRange === null || maxRange > self.maxRange) {
            changed = true;
            self.maxRange = maxRange;
        }

        if (changed && self.minRange !== null && self.maxRange !== null) {
            self._setExtremes(self.minRange, self.maxRange, 'navigator-x-axis', eventPayload);
        }
    };

    StreamList.prototype.matchWith = function (a, b) {
        var self = this;

        if (!a.tags.visualization.with) return false;

        // TODO: Should we use _.findWhere?
        if (!_.isEqual(_.pick(b.tags, _.keys(a.tags.visualization.with)), a.tags.visualization.with)) return false;

        // TODO: Should we compare highest granularity as well and require it to be the same? Or should we look at the combined streams to have the highest granularity based on the highest granularity of all of them?
        if (a.tags.visualization.minimum !== b.tags.visualization.minimum || a.tags.visualization.maximum !== b.tags.visualization.maximum || a.tags.visualization.unit !== b.tags.visualization.unit) {
            console.warn("Streams matched, but incompatible Y axis", a, b);
            return false;
        }

        return true;
    };

    // Streams can be declared to be with some other stream and should be displayed together.
    // This method finds a stream where or withStream or another stream has declared another
    // to be with.
    StreamList.prototype.isWith = function (withStream) {
        var self = this;

        var match = null;

        for (var id in self.streams) {
            if (!self.streams.hasOwnProperty(id)) continue;

            var stream = self.streams[id];

            // withStream might be in the self.streams, ignore it (otherwise it
            // cloud match itself below and break things).
            if (stream === withStream) continue;

            if (self.matchWith(stream, withStream) || self.matchWith(withStream, stream)) {
                match = stream;
                break;
            }
        }

        return match;
    };

	$.fn.datastream = function (options) {
        if (!$.isReady) {
            console.error("Use of datastream before DOM was ready");
            return this;
        }
        options = $.extend(true, {}, $.fn.datastream.defaults, options);

        if (this.length === 0) {
            console.warn("Use of datastream on an empty group of elements");
            return this;
        }

        this.each(function (i, element) {
            var streamList = new StreamList(element, options);

            var nextUri = options.streamListUri;
            var nextParams = options.streamListParams;
            // Handle pagination.
            async.whilst(function () {
                return !!nextUri;
            }, function (callback) {
                getJSON(nextUri, nextParams, function (data, textStatus, jqXHR) {
                    _.each(data.objects, function (stream, i) {
                        streamList.newStream(stream);
                    });

                    nextUri = data.meta.next;
                    // All params are already in "next".
                    nextParams = {};
                    callback();
                }).fail(function () {
                    callback(arguments);
                });
            }, function (err) {
                // Do nothing, Ajax errors should be handled globally.
            });
        });

        return this;
    };

    $.fn.datastream.defaults = {
        'streamListUri': '/api/v1/stream/',
        'streamListParams': {}
    };

})(jQuery);
