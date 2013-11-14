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

var width = 100;

var granularities = [
    {'name': 'days', 'duration': 86400},
    {'name': '6hours', 'duration': 21600},
    {'name': 'hours', 'duration': 3600},
    {'name': '10minutes', 'duration': 600},
    {'name': 'minutes', 'duration': 60},
    {'name': '10seconds', 'duration': 10},
    {'name': 'seconds', 'duration': 1}
]

function firstDefined(obj) {
    for (var i = 1; i < arguments.length; i++) {
        if (typeof obj[arguments[i]] !== 'undefined') {
            return obj[arguments[i]];
        }
    }
}

function updateKnownMaxRange(stream) {
    assert(stream.id in activeStreams);

    var activeStream = activeStreams[stream.id];

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
    plot = new Highcharts.StockChart({
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
                'data': [] // We will set data manually
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
            'minRange': width * 1000 // TODO: Should this depend on possible granularity for the stream(s)?
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
    });
}

function tagsToObject(tags) {
    result = {};
    $.each(tags, function (i, tag) {
        if ($.isPlainObject(tag)) {
            $.extend(result, tag);
        }
        else {
            result[tag] = tag;
        }
    });
    return result;
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

function convertDatapoints(datapoints, start, end) {
    var line = [];
    var range = [];

    if (typeof start !== 'undefined') {
        var firstDatapoint = convertDatapoint(datapoints[0])
        if (firstDatapoint.range[0] > start) {
            line.push([start, null])
            range.push([start, null, null])
        }
    }

    $.each(datapoints, function (i, datapoint) {
        datapoint = convertDatapoint(datapoint);
        line.push(datapoint.line);
        range.push(datapoint.range);
    });

    if (typeof end !== 'undefined') {
        var lastDatapoint = convertDatapoint(datapoints[datapoints.length - 1])
        if (lastDatapoint.range[0] < end) {
            line.push([end, null])
            range.push([end, null, null])
        }
    }

    return {
        'line': line,
        'range': range
    };
}

function computeRange(min, max) {
    var range = {
        'granularity': granularities[0]
    }

    if (!$.isNumeric(min) || !$.isNumeric(min)) {
        return range;
    }

    range.start = min / 1000;
    range.end = max / 1000;

    var interval = range.end - range.start;

    $.each(granularities, function (i, granularity) {
        if (interval / granularity.duration > width) {
            range.granularity = granularity;
            return false;
        }
    });

    range.start -= range.granularity.duration / 2;
    range.end += range.granularity.duration / 2;

    range.start = parseInt(Math.floor(range.start));
    range.end = parseInt(Math.floor(range.end));

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
    var streams = $.map(activeStreams, function (stream, id) {
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

            var datapoints = convertDatapoints(data.datapoints, range.start * 1000, range.end * 1000);
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

        var datapoints = convertDatapoints(data.datapoints, range.start * 1000, range.end * 1000);

        plot.addAxis({
            'id': 'axis-' + stream.id,
            'title': {
                'text': stream.tags.unit
            },
            'showEmpty': false
        });
        var series = plot.addSeries({
            'id': 'range-' + stream.id,
            'name': stream.tags.name,
            'yAxis': 'axis-' + stream.id,
            'type': 'arearange',
            'lineWidth': 0,
            'fillOpacity': 0.3,
            'tooltip': {
                'pointFormat': '<span style="color:{series.color}">{series.name} min/max</span>: <b>{point.low}</b> - <b>{point.high}</b><br/>',
                'valueDecimals': 3
            },
            'data': datapoints.range
        });
        // Match yAxis title color with series color
        series.yAxis.axisTitle.css({'color': series.color});
        plot.addSeries({
            'id': 'line-' + stream.id,
            'name': stream.tags.name,
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
        if (navigator.data.length === 0) {
            // TODO: Should we set some better data for navigator?
            navigator.setData(datapoints.line);
            // Without the following range selector is not displayed until first zooming
            // We cannot just call plot.xAxis[0].setExtremes(), for some reason it does
            // not correctly initialize the selector to cover the whole range but it leaves
            // few pixles, so we pass extremes ourselves
            var unionExtremes = (plot.scroller && plot.scroller.getUnionExtremes()) || plot.xAxis[0] || {};
            plot.xAxis[0].setExtremes(unionExtremes.dataMin, unionExtremes.dataMax);
        }
    }).always(function () {
        hideLoading();
    });
}

var activeStreams = {};
var plot = null;

$(document).ready(function () {
    $('#streams').empty();

    $.getJSON('/api/v1/stream/', function (data, textStatus, jqXHR) {
        $.each(data.objects, function (i, stream) {
            if (data.id in activeStreams) return;

            stream.tags = tagsToObject(stream.tags);

            $('<li/>').data(stream).html(prettyPrint(stream.tags)).appendTo('#streams').click(function (e) {
                activeStreams[stream.id] = stream;
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