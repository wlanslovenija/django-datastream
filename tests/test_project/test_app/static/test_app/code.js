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

function Stream(stream) {
    var self = this;

    _.extend(self, stream);

    self.initializeChart(function () {
        self.loadInitialData();
    });
}

Stream.prototype.initializeChart = function (callback) {
    var self = this;

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
            'events': {
                'afterSetExtremes': function (event) {
                    if (event.syncing) {
                        // It is our event and we are syncing extremes between charts, load data for this chart
                        self.loadData(event);
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
        self.chart = chart;
        self.chart.loadingShown = 0;
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

Stream.prototype.convertDatapoint = function (datapoint) {
    var self = this;

    // TODO: Convert based on visualization tags

    var t = moment.utc(_.isObject(datapoint.t) ? datapoint.t.m : datapoint.t).valueOf();
    if (_.isObject(datapoint.v)) {
        return {
            'line': [t, datapoint.v.m],
            'range': [t, datapoint.v.l, datapoint.v.u]
        }
    }
    else {
        return {
            'line': [t, datapoint.v],
            'range': [t, datapoint.v, datapoint.v]
        }
    }
};

Stream.prototype.convertDatapoints = function (datapoints) {
    var self = this;

    // TODO: Convert based on visualization tags

    var line = [];
    var range = [];

    _.each(datapoints, function (datapoint, i) {
        datapoint = self.convertDatapoint(datapoint);
        line.push(datapoint.line);
        range.push(datapoint.range);
    });

    return {
        'line': line,
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
        'limit': MAX_DETAIL_LIMIT
        // TODO: Limit time and value downsamplers
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, self.id);

        var datapoints = self.convertDatapoints(data.datapoints);

        self.chart.addAxis({
            'id': 'axis-' + self.id,
            'title': {
                'text': [self.tags.unit_description || "", self.tags.unit ? "[" + self.tags.unit + "]" : ""].join(" ")
            },
            'showEmpty': false
        });
        var series = self.chart.addSeries({
            'id': 'range-' + self.id,
            'streamId': self.id, // Our own option
            'name': self.tags.title,
            'yAxis': 'axis-' + self.id,
            'type': 'arearange',
            'lineWidth': 0,
            'fillOpacity': 0.3,
            'tooltip': {
                'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>',
                'valueDecimals': 3
            },
            'selected': true, // By default all streams are selected/highlighted
            'events': {
                'legendItemClick': function (e) {
                    e.preventDefault();

                    this.select();

                    // We force mouse leave event to immediately set highlights
                    $(this.legendGroup.element).trigger('mouseleave.highlight');
                }
            },
            'data': datapoints.range
        });
        // Match yAxis title color with series color
        series.yAxis.axisTitle.css({'color': series.color});
        self.chart.addSeries({
            'id': 'line-' + self.id,
            'streamId': self.id, // Our own option
            'name': self.tags.title,
            'linkedTo': 'range-' + self.id,
            'yAxis': 'axis-' + self.id,
            'type': 'spline',
            'color': series.color,
            'tooltip': {
                'pointFormat': '<span style="color:{series.color}">{series.name} mean</span>: <b>{point.y}</b><br/>',
                'valueDecimals': 3
            },
            'data': datapoints.line
        });
        var navigator = self.chart.get('navigator');
        self.chart.addAxis(_.extend({}, navigator.yAxis.options, {
            'id': 'navigator-y-axis-' + self.id
        }));
        self.chart.addSeries(_.extend({}, navigator.options, {
            'id': 'navigator-' + self.id,
            'streamId': self.id, // Our own option
            'color': series.color,
            'data': datapoints.line,
            'yAxis': 'navigator-y-axis-' + self.id
        }));

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

Stream.prototype.loadData = function (event) {
    var self = this;

    var range = self.computeRange(event.min, event.max);

    self.showLoading();
    $.getJSON(self.resource_uri, {
        'granularity': range.granularity.name,
        'limit': 1000, // TODO: How much exactly do we want?
        'start': range.start,
        'end': range.end
        // TODO: Limit time and value downsamplers
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, self.id);

        // TODO: Convert based on visualization tags
        var datapoints = self.convertDatapoints(data.datapoints);
        self.chart.get('line-' + self.id).setData(datapoints.line);
        self.chart.get('range-' + self.id).setData(datapoints.range);

        self.hideLoading();

        page.updateKnownMaxRange(data);
    }).fail(function () {
        self.hideLoading();
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

    self.streams[stream.id] = new Stream(stream);
};

Page.prototype.setExtremes = function (event) {
    var self = this;

    var charts =_.uniq(_.pluck(_.values(self.streams), 'chart'));

    _.each(charts, function (chart, i) {
        // We set "syncing" flag on the event so that charts know that they have to load data now
        chart.xAxis[0].setExtremes(event.min, event.max, true, null, {'syncing': true});
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

    if (!_.isUndefined(start) && (self.minRange === null || moment.utc(start).valueOf() < self.minRange)) {
        self.minRange = moment.utc(start).valueOf();
    }
    if (!_.isUndefined(end) && (self.maxRange === null || moment.utc(end).valueOf() > self.maxRange)) {
        self.MaxRange = moment.utc(end).valueOf();
    }

    if (self.minRange !== null && self.maxRange !== null) {
        // TODO: Update all charts
        //(self.minRange, self.maxRange);
    }
};

var page = new Page();

$(document).ready(function () {
    // TODO: Will load only the first page of streams
    // TODO: Allow some way of filtering streams
    $.getJSON('/api/v1/stream/', function (data, textStatus, jqXHR) {
        _.each(data.objects, function (stream, i) {
            page.newStream(stream);
        });
    });

    $(document).ajaxError(function (event, jqXHR, ajaxSettings, thrownError) {
        console.error(event, jqXHR, ajaxSettings, thrownError);
    });
});