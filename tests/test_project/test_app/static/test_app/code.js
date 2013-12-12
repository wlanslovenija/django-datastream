/**
 * Plugin for setting a lower opacity for other series than the one that is hovered over.
 * Additionally, if not hovering over, a lower opacity is set based on series selected status.
 */
(function (Highcharts) {
    function highlightOn(allSeries, currentSeries) {
        return function (e) {
            $.each(allSeries, function (i, series) {
                if (i === 0) {
                    // We skip (empty) navigator series
                    assert.equal(series.data.length, 0);
                    return;
                }

                var current = (series === currentSeries) || (series.linkedParent === currentSeries) || (series.options.streamId === currentSeries.options.streamId);
                $.each(['group', 'markerGroup'], function (j, group) {
                    series[group].attr('opacity', current ? 1.0 : 0.25);
                });
                series.chart.legend.colorizeItem(series, current);
            });
        };
    }

    function highlightOff(allSeries, currentSeries) {
        return function (e) {
            $.each(allSeries, function (i, series) {
                if (i === 0) {
                    // We skip (empty) navigator series
                    assert.equal(series.data.length, 0);
                    return;
                }

                assert(series.options.streamId);

                var selected = series.selected || _.some(_.filter(allSeries, function (s) {return s.options.streamId === series.options.streamId}), function (s) {return s.selected});

                $.each(['group', 'markerGroup'], function (j, group) {
                    series[group].attr('opacity', selected ? 1.0 : 0.25);
                });
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

// From: http://jsfiddle.net/unLSJ/

function prettyPrint(obj) {
    var jsonLine = /^( *)("[\w]+": )?("[^"]*"|[\w.+-]*)?([,[{])?$/mg;
    return JSON.stringify(obj, null, 3)
        .replace(/&/g, '&amp;').replace(/\\"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(jsonLine, replacer);
}

function replacer(match, pIndent, pKey, pVal, pEnd) {
    var key = '<span class=json-key>';
    var val = '<span class=json-value>';
    var str = '<span class=json-string>';
    var r = pIndent || '';
    if (pKey)
        r = r + key + pKey.replace(/[": ]/g, '') + '</span>: ';
    if (pVal)
        r = r + (pVal[0] == '"' ? str : val) + pVal + '</span>';
    return r + (pEnd || '');
}

// TODO: This curently does not depend on how many datapoints are really available, so if granularity is seconds, it assumes that every second will have a datapoint
// TODO: Should this depend on possible granularity for the stream(s)? Or some other hint?
var MAX_POINTS_NUMBER = 300;

var granularities = [
    {'name': 'days', 'duration': 86400},
    {'name': '6hours', 'duration': 21600},
    {'name': 'hours', 'duration': 3600},
    {'name': '10minutes', 'duration': 600},
    {'name': 'minutes', 'duration': 60},
    {'name': '10seconds', 'duration': 10},
    {'name': 'seconds', 'duration': 1}
];

function firstDefined(obj) {
    for (var i = 1; i < arguments.length; i++) {
        if (typeof obj[arguments[i]] !== 'undefined') {
            return obj[arguments[i]];
        }
    }
}

function updateKnownMaxRange(stream) {
    assert(stream.id in streams);

    var activeStream = streams[stream.id];

    if (!('range' in activeStream)) {
        activeStream.range = {};
    }

    if (stream.datapoints.length === 0) {
        return;
    }

    var firstDatapoint = stream.datapoints[0];
    var lastDatapoint = stream.datapoints[stream.datapoints.length - 1];

    // We go through downsampled timestamps in such order to maximize the range
    var start = $.isPlainObject(firstDatapoint.t) ? firstDefined(firstDatapoint.t, 'a', 'e', 'm', 'z') : firstDatapoint.t;
    var end = $.isPlainObject(lastDatapoint.t) ? firstDefined(lastDatapoint.t, 'z', 'm', 'e', 'a') : lastDatapoint.t;

    if ((typeof start !== 'undefined') && ((typeof activeStream.range.start === 'undefined') || (moment.utc(start).valueOf() < activeStream.range.start))) {
        activeStream.range.start = moment.utc(start).valueOf();
    }
    if ((typeof end !== 'undefined') && ((typeof activeStream.range.end === 'undefined') || (moment.utc(end).valueOf() > activeStream.range.end))) {
        activeStream.range.end = moment.utc(end).valueOf();
    }
}

function initializePlot() {
    new Highcharts.StockChart({
        'chart': {
            'renderTo': 'plot',
            'type': 'spline',
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
                'afterSetExtremes': reloadGraphData
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
    }, function (p) {
        // Store initialized plot to the global variable
        plot = p;
    });
}

function convertDatapoint(datapoint) {
    var t = moment.utc($.isPlainObject(datapoint.t) ? datapoint.t.m : datapoint.t).valueOf();
    if ($.isPlainObject(datapoint.v)) {
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
}

function convertDatapoints(datapoints) {
    var line = [];
    var range = [];
    $.each(datapoints, function (i, datapoint) {
        datapoint = convertDatapoint(datapoint);
        line.push(datapoint.line);
        range.push(datapoint.range);
    });
    return {
        'line': line,
        'range': range
    };
}

function computeRange(min, max) {
    var range = {
        'granularity': granularities[0]
    };

    if (!$.isNumeric(min) || !$.isNumeric(min)) {
        return range;
    }

    // In JavaScript timestamps are in miliseconds, but server sides uses them in seconds
    range.start = min / 1000;
    range.end = max / 1000;

    var interval = range.end - range.start;

    $.each(granularities, function (i, granularity) {
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
}

var loadingShown = 0;

function showLoading() {
    assert(loadingShown >= 0);

    loadingShown++;
    if (loadingShown === 1) {
        plot.showLoading("Loading data from server...");
    }
}

function hideLoading() {
    assert(loadingShown > 0);

    loadingShown--;
    if (loadingShown === 0) {
        plot.hideLoading();
    }
}

function reloadGraphData(event) {
    var range = computeRange(event.min, event.max);
    var streams = $.map(streams, function (stream, id) {
        return stream;
    });
    showLoading();
    async.each(streams, function (stream, cb) {
        $.getJSON(stream.resource_uri, {
            'granularity': range.granularity.name,
            'limit': 10000,
            'start': range.start,
            'end': range.end
        }, function (data, textStatus, jqXHR) {
            assert.equal(data.id, stream.id);

            updateKnownMaxRange(data);

            var datapoints = convertDatapoints(data.datapoints);
            plot.get('line-' + stream.id).setData(datapoints.line);
            plot.get('range-' + stream.id).setData(datapoints.range);

            cb();
        }).fail(function () {
            cb(arguments);
        });
    }, function (err) {
        hideLoading();
    });
}

function addPlotData(stream) {
    var range = computeRange(plot.xAxis[0].userMin, plot.xAxis[0].userMax);
    showLoading();
    $.getJSON(stream.resource_uri, {
        'granularity': range.granularity.name,
        'limit': 10000,
        'start': range.start,
        'end': range.end
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, stream.id);

        updateKnownMaxRange(data);

        var datapoints = convertDatapoints(data.datapoints);

        plot.addAxis({
            'id': 'axis-' + stream.id,
            'title': {
                // TODO: Automatically prefx unit if provided
                'text': [(stream.tags.unit || ''), (stream.tags.unit_description || '')].join(' ')
            },
            'showEmpty': false
        });
        var series = plot.addSeries({
            'id': 'range-' + stream.id,
            'streamId': stream.id, // Our own option
            'name': stream.tags.title,
            'yAxis': 'axis-' + stream.id,
            'type': 'arearange',
            'lineWidth': 0,
            'fillOpacity': 0.3,
            'tooltip': {
                'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>',
                'valueDecimals': 3
            },
            'selected': true,
            'events': {
                'legendItemClick': function (e) {
                    e.preventDefault();

                    this.select();

                    // We force mouse leave event to immediately set opacity
                    $(this.legendGroup.element).trigger('mouseleave.highlight');
                }
            },
            'data': datapoints.range
        });
        // Match yAxis title color with series color
        series.yAxis.axisTitle.css({'color': series.color});
        plot.addSeries({
            'id': 'line-' + stream.id,
            'streamId': stream.id, // Our own option
            'name': stream.tags.title,
            'linkedTo': 'range-' + stream.id,
            'color': series.color,
            'yAxis': 'axis-' + stream.id,
            'tooltip': {
                'pointFormat': '<span style="color:{series.color}">{series.name} mean</span>: <b>{point.y}</b><br/>',
                'valueDecimals': 3
            },
            'data': datapoints.line
        });
        var navigator = plot.get('navigator');
        plot.addAxis(_.extend({}, navigator.yAxis.options, {
            'id': 'navigator-y-axis-' + stream.id
        }));
        plot.addSeries(_.extend({}, navigator.options, {
            'id': 'navigator-' + stream.id,
            'streamId': stream.id, // Our own option
            'color': series.color,
            'data': datapoints.line,
            'yAxis': 'navigator-y-axis-' + stream.id
        }));
        // TODO: Improve/fix this
        var unionExtremes = (plot.scroller && plot.scroller.getUnionExtremes()) || plot.xAxis[0] || {};
        plot.xAxis[0].setExtremes(unionExtremes.dataMin, unionExtremes.dataMax);
    }).always(function () {
        hideLoading();
    });
}

var streams = {};
var plot = null;

$(document).ready(function () {
    $('#streams').empty();

    $.getJSON('/api/v1/stream/', function (data, textStatus, jqXHR) {
        $.each(data.objects, function (i, stream) {
            if (data.id in streams) return;

            $('<li/>').data(stream).html(prettyPrint(stream.tags)).appendTo('#streams').click(function (e) {
                streams[stream.id] = stream;
                addPlotData(stream);
                $(this).remove();
            });
        });
    });

    $(document).ajaxError(function (event, jqXHR, ajaxSettings, thrownError) {
        console.error(event, jqXHR, ajaxSettings, thrownError);
    });

    initializePlot();
});