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

width = 100;

granularities = [
    {'name': 'days', 'duration': 86400},
    {'name': '6hours', 'duration': 21600},
    {'name': 'hours', 'duration': 3600},
    {'name': '10minutes', 'duration': 600},
    {'name': 'minutes', 'duration': 60},
    {'name': '10seconds', 'duration': 10},
    {'name': 'seconds', 'duration': 1}
]

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
            'adaptToUpdatedData': false,
            'baseSeries': 0
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

function convertDatapoints(datapoints) {
    result = []
    $.each(datapoints, function (i, datapoint) {
        result.push([moment.utc(datapoint.t.m || datapoint.t).valueOf(), (datapoint.v.m || datapoint.v)]);
    });
    return result;
}

function reloadGraphData(event) {
    granularity = granularities[0]
    start = event.min / 1000;
    end = event.max / 1000;

    interval = end - start

    $.each(granularities, function (i, g) {
        if (interval / g.duration > width) {
            granularity = g;
            return false;
        }
    });

    start -= granularity.duration / 2;
    end += granularity.duration / 2;

    start = parseInt(Math.floor(start));
    end = parseInt(Math.floor(end));

    $.each(activeStreams, function (id, stream) {
        $.getJSON(stream.resource_uri, {
            'granularity': granularity.name,
            'limit': 10000,
            'start': start,
            'end': end
        }, function (data, textStatus, jqXHR) {
            assert.equal(data.id, stream.id);

            plot.get('m-' + stream.id).setData(convertDatapoints(data.datapoints));
        });
    });
}

function addPlotData(stream) {
    $.getJSON(stream.resource_uri, {
        'granularity': 'days',
        'limit': 10000
    }, function (data, textStatus, jqXHR) {
        assert.equal(data.id, stream.id);

        plot.addAxis({
            'id': 'axis-' + stream.id,
            'title': {
                'text': stream.tags.unit
            },
            'showEmpty': false
        });
        var series = plot.addSeries({
            'id': 'm-' + stream.id,
            'name': stream.tags.name,
            'yAxis': 'axis-' + stream.id,
            'data': convertDatapoints(data.datapoints)
        });
        // Match yAxis title color with series color
        series.yAxis.axisTitle.css({'color': series.color});
    });
}

activeStreams = {};
plot = null;

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