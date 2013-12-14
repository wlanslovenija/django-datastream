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

// TODO: This curently does not depend on how many datapoints are really available, so if granularity is seconds, it assumes that every second will have a datapoint
// TODO: Should this depend on possible granularity for the stream(s)? Or some other hint?
var MAX_POINTS_NUMBER = 300;
var MAX_DETAIL_LIMIT = 10000;

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

function setsEqual(a, b) {
    return (a === b) || (a && b && a.length === b.length && _.difference(a, b).length === 0);
}

function Stream(stream) {
    var self = this;

    _.extend(self, stream);

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

    self.lastRangeStart = null;
    self.lastRangeEnd = null;

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

    self.getChart(function () {
        self.loadInitialData();
    });
}

Stream.prototype.getChart = function (callback) {
    var self = this;

    var existing = page.isWith(self);
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
    // in callbacks will make things work only for the first stream
    $('<div/>').addClass('chart').appendTo('#charts').highcharts('StockChart', {
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
                    if (event.syncing) {
                        // It is our event and we are syncing extremes between charts, load data for all streams in this chart
                        var streams = _.uniq(_.filter(_.map(self.chart.series, function (series, i) {
                            return series.options.streamId;
                        }), function (series) {return !!series;}));
                        page.loadData(event, streams);
                    }
                    else {
                        // User changed extremes, first sync all charts
                        page.setExtremes(event);
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
                return [t].concat(_.map(mainType.keys, function (key, j) {return datapoint.v[key];}));
            }),
            'range': _.map(self.rangeTypes, function (rangeType, i) {
                return [t].concat(_.map(rangeType.keys, function (key, j) {return datapoint.v[key];}));
            })
        }
    }
    else {
        return {
            'main': [[t].concat(_.map(self.mainTypes[0].keys, function (key, i) {return datapoint.v;}))],
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

Stream.prototype.loadInitialData = function () {
    var self = this;

    self.showLoading();

    $.getJSON(self.resource_uri, {
        // Use lowest granularity and no bounds to get initial data
        'granularity': GRANULARITIES[0].name,
        // We want to get all we can, we are loading days so it should not be so bad
        'limit': MAX_DETAIL_LIMIT,
        'value_downsamplers': self.valueDownsamplers(true),
        'time_downsamplers': self.timeDownsamplers(true)
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, self.id);

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
        self.chart.xAxis[0].setExtremes();

        page.updateKnownMaxRange(data);
    }).always(function () {
        self.hideLoading();
    });
};

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

    _.each(GRANULARITIES, function (granularity, i) {
        if (interval / granularity.duration > MAX_POINTS_NUMBER) {
            return false;
        }
        range.granularity = granularity;
    });

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

Stream.prototype.loadData = function (event) {
    var self = this;

    var range = self.computeRange(event.min, event.max);

    if (range.start === self.lastRangeStart && range.end === self.lastRangeEnd) {
        // Nothing really changed
        return;
    }

    self.showLoading();
    $.getJSON(self.resource_uri, {
        'granularity': range.granularity.name,
        'limit': 1000, // TODO: How much exactly do we want?
        'start': range.start,
        'end': range.end,
        'value_downsamplers': self.valueDownsamplers(),
        'time_downsamplers': self.timeDownsamplers()
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, self.id);

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

        page.updateKnownMaxRange(data);
    }).fail(function () {
        self.hideLoading();
    });
};

Page.prototype.loadData = function (event, streams) {
    var self = this;

    _.each(_.pick(self.streams, streams), function (stream, id) {
        stream.loadData(event);
    });
};

function Page() {
    var self = this;

    self.streams = {};
    self.minRange = null;
    self.maxRange = null;
}

Page.prototype.newStream = function (stream) {
    var self = this;

    assert(!_.has(self.streams, stream.id));

    if (!stream.tags.visualization.hidden) {
        try {
            self.streams[stream.id] = new Stream(stream);
        }
        catch (e) {
            // We ignore the exception beause we have already logged it
        }
    }
};

Page.prototype.setExtremes = function (event) {
    var self = this;

    self._setExtremes(event.min, event.max, 'x-axis');
};

Page.prototype._setExtremes = function (min, max, axis) {
    var self = this;

    var charts =_.uniq(_.pluck(_.values(self.streams), 'chart'));

    _.each(charts, function (chart, i) {
        // We set "syncing" flag on the event so that charts know that they have to load data now
        chart.get(axis).setExtremes(min, max, true, false, {'syncing': true});
    });
};

Page.prototype.updateKnownMaxRange = function (data) {
    var self = this;

    assert(_.has(self.streams, data.id));

    if (!data.datapoints || data.datapoints.length === 0) {
        return;
    }

    var firstDatapoint = data.datapoints[0];
    var lastDatapoint = data.datapoints[data.datapoints.length - 1];

    // We go through downsampled timestamps in such order to maximize the range
    var start = _.isObject(firstDatapoint.t) ? firstDefined(firstDatapoint.t, 'a', 'e', 'm', 'z') : firstDatapoint.t;
    var end = _.isObject(lastDatapoint.t) ? firstDefined(lastDatapoint.t, 'z', 'm', 'e', 'a') : lastDatapoint.t;

    var changed = false;

    if (!_.isUndefined(start) && (self.minRange === null || moment.utc(start).valueOf() < self.minRange)) {
        changed = true;
        self.minRange = moment.utc(start).valueOf();
    }
    if (!_.isUndefined(end) && (self.maxRange === null || moment.utc(end).valueOf() > self.maxRange)) {
        changed = true;
        self.maxRange = moment.utc(end).valueOf();
    }

    if (changed && self.minRange !== null && self.maxRange !== null) {
        self._setExtremes(self.minRange, self.maxRange, 'navigator-x-axis');
    }
};

Page.prototype.matchWith = function (a, b) {
    var self = this;

    if (!a.tags.visualization.with) return false;

    // TODO: Should we use _.findWhere?
    if (!_.isEqual(_.pick(b.tags, _.keys(a.tags.visualization.with)), a.tags.visualization.with)) return false;

    if (a.tags.visualization.minimum !== b.tags.visualization.minimum || a.tags.visualization.maximum !== b.tags.visualization.maximum || a.tags.visualization.unit !== b.tags.visualization.unit) {
        console.warn("Streams matched, but incompatible Y axis", a, b);
        return false;
    }

    return true;
};

Page.prototype.isWith = function (withStream) {
    var self = this;

    var match = null;

    _.each(self.streams, function (stream, id) {
        if (match) return;

        if (self.matchWith(stream, withStream) || self.matchWith(withStream, stream)) {
            match = stream;
        }
    });

    return match;
};

var page = new Page();

$(document).ready(function () {
    $.ajaxSetup({
        'traditional': true
    });

    $(document).ajaxError(function (event, jqXHR, ajaxSettings, thrownError) {
        console.error(event, jqXHR, ajaxSettings, thrownError);
    });

    // TODO: Will load only the first page of streams
    // TODO: Allow some way of filtering streams
    $.getJSON('/api/v1/stream/', function (data, textStatus, jqXHR) {
        _.each(data.objects, function (stream, i) {
            page.newStream(stream);
        });
    });
});