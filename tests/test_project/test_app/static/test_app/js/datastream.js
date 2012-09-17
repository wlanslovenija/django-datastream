(function($, undefined) {

    var debug,
        plots = {},
        cached_data = {},
        current_plot_id = 0,
        datastream_location = '',
        restful_api_location = 'api/v1/metric/';

    $(document).ready(function () {
        debug = $('#debug');

        if (!debug.length) {
            debug = false;
        }
    });

    // #8138, IE may throw an exception when accessing
    // a field from window.location if document.domain has been set
    try {
        datastream_location = location.href + restful_api_location;
    } catch (e) {
        // Use the href attribute of an A element
        // since IE will modify it given document.location
        datastream_location = document.createElement( "a" );
        datastream_location.href = "";
        datastream_location = datastream_location.href + restful_api_location;
    }

    function Datastream(placeholder, options) {

        var add_metric = undefined;

        if (options && options.metrics) {
            options = $.extend(options, { 'datastream': {'metrics': options.metrics }});
            delete options.metrics;
        }

        if (options && options.add_metric) {
            add_metric = options.add_metric;
            delete options.add_metric;
        }

        this.options = $.extend({}, $.datastream.defaults, options);
        this.placeholder = placeholder;

        if (placeholder.children('canvas').length > 0 && add_metric) {

            // if selected existig canvas, add metric
            var plot_id = placeholder.attr('id');
            this.options.datastream.metrics.push(add_metric);
            plots[plot_id].addMetric(add_metric);

        } else {

            // else add new plot
            var plot_id = $.datastream.nextId();
            placeholder.append('<div ' + 'id=\'' + plot_id + '\' ' +
                'style=\'width:' + this.options.width + 'px; ' +
                'height:' + this.options.height + 'px\'></div>');

            plots[plot_id] = $.plot('#' + plot_id, [[]], this.options);
        }
    }

    $.datastream = {};

    $.fn.datastream = function (options) {
        return this.each(function () {
            (new Datastream($(this), options));
        });
    };

    $.datastream.metricList = function (callback) {
        $.getJSON($.datastream.defaults.url, function (data) {
                callback(data.objects);
            }
        );
    };

    $.datastream.metricName = function (metric) {
        var name_tag = $(metric).attr("tags").filter(function (o) { return o.name; });
        return (name_tag.length > 0) ? name_tag[0].name : undefined;
    };

    $.datastream.nextId = function () {
        current_plot_id += 1;
        return 'plot_' + current_plot_id;
    };

    $.datastream.currentId = function () {
        return 'plot_' + current_plot_id;
    };

    $.datastream.defaults = {
        'url': datastream_location,
        'width': 400,
        'height': 200,
        'from': null,
        'to': null,
        'datastream': {
            'metrics': []
        },
        'selection': {
            'mode': "x",
            'click': 3
        },
        'crosshair': {
            'mode': "x"
        },
        'grid': {
            'hoverable': true,
            'autoHighlight': false
        },
        'zoom': {
            'interactive': false,
            'trigger': 'dblclick',
            'amount': 1.5
        },
        'pan': {
            'interactive': true,
            'cursor': 'move',
            'frameRate': 20
        },
        'xaxis': {
            'zoomRange': null,
            'panRange': null
        },
        'yaxis': {
            'zoomRange': false,
            'panRange': false
        }
    };

    var flot_defaults = {
        'url': datastream_location,
        'datastream': null,
        'from': null,
        'to': null
    };

    function getMetricData(metric_id, granularity, from, to, callback) {

        if (cached_data[metric_id] && cached_data[metric_id][granularity]) {
            callback(cached_data[metric_id][granularity]);

        } else {
            var get_url = $.datastream.defaults.url + metric_id + '/?g=' + granularity + '&s=' + from + '&e=' + to + '&d=m';

            if (debug) {
                window.console.log('GET ' + get_url);
            }

            $.getJSON(get_url,
                function (data) {
                    if (!cached_data.metric_id) {
                        cached_data[metric_id] = {};
                    }
                    cached_data[metric_id][granularity] = data;
                    callback(data);
                }
            );
        }
    }

    function init(plot) {
        var enabled = false,
            metrics = [],
            zoom_stack = [];

        plot.metrics = function() {
            return metrics;
        };

        function processOptions(plot, s) {
            if (s.datastream) {
                enabled = true;
                metrics = s.datastream.metrics;

                if (s.to === null) {
                    s.to = Math.floor(new Date().getTime() / 1000.0);
                } else if (jQuery.type(s.to) === 'date') {
                    s.to = Math.floor(s.to.getTime() / 1000.0)
                }

                if (s.from === null) {
                    s.from = s.to - 60*60*24*7;
                } else if (jQuery.type(s.from) === 'date') {
                    s.from = Math.floor(s.from.getTime() / 1000.0)
                }

                plot.getAxes().xaxis.options.mode = 'time';
                plot.getAxes().xaxis.options.ticks = Math.floor(plot.getPlaceholder().width() / 75);
            }
        }

        function updateData(plot, data) {
            var t, v, i = 0,
                newpoints = [],
                o = plot.getOptions();

            if (debug) {
                window.console.log('RESPONSE: data fetched');
            }

            for (i; i < data.datapoints.length; i += 1) {
                t = data.datapoints[i].t;
                v = data.datapoints[i].v;

                if ($.isPlainObject(t)) {
                    t = new Date(t.a).getTime();
                } else {
                    t = new Date(t).getTime();
                }

                if ($.isPlainObject(v)) {
                    v = v.m;
                } else {
                    v = v;
                }

                newpoints.push([t, v]);
            }

            var new_data = [];
            $.each(plot.getData(), function(key, val) {
                if (val.data.length !== 0) {
                    new_data.push({'data': val.data, 'label': val.label});
                    delete val.data;
                }
            });

            new_data.push({'data': newpoints, 'label': $.datastream.metricName(data) + ' = ?'});

            if (debug) {
                function toDebugTime(seconds) {
                    function twoDigits(digit) {
                        return ("0" + digit).slice(-2);
                    }

                    var d = new Date();
                    d.setTime(seconds * 1000);
                    return twoDigits(d.getHours()) + ':' +
                        twoDigits(d.getMinutes()) + ':' +
                        twoDigits(d.getSeconds()) + ' ' +
                        twoDigits(d.getDate()) + '.' +
                        twoDigits(d.getMonth() + 1) + '.' +
                        d.getFullYear();
                }

                debug.find('#debugTable tr:last').after(
                    '<tr><td>' + $.datastream.metricName(data) + '</td>' +
                        '<td>' + data.granularity + '</td>' +
                        '<td>' + toDebugTime(o.from) + '</td>' +
                        '<td>' + toDebugTime(o.to) + '</td>' +
                        '<td>' + newpoints.length + '</td></tr>'
                );
            }

            if (debug) {
                window.console.log('PARSED: data');
            }

            plot.setData(new_data);
            plot.setupGrid();
            plot.draw();
        }

        plot.addMetric = function(metric) {
            var i,
                o = plot.getOptions(),
                span = o.to - o.from,
                gr = ["s", "m", "h", "d"],
                grf = [1, 60, 3600, 86400];

            for (i = 0; i < gr.length; i++) {
                if (span / grf[i] < 2 * o.width) {
                    break;
                }
            }

            i = (i > 0) ? i - 1 : i;

            if (!$.inArray(metric, o.datastream.metrics)) {
                o.datastream.metrics.push(metric);
            }

            getMetricData(metric, gr[i], o.from, o.to, function (data) {
                updateData(plot, data);
            });
        };

        function fetchData(plot) {

            $.each(metrics, function(key, val) {
                plot.addMetric(val);
            });
        }

        function zoom(from, to) {
            var xaxes_options = plot.getAxes().xaxis.options;
            zoom_stack.push({'min': xaxes_options.min, 'max': xaxes_options.max});
            xaxes_options.min = from;
            xaxes_options.max = to;

            plot.clearSelection();
            plot.setupGrid();
            plot.draw();

            // Stupid work-around. For crosshair to work we must set selection
            // plugin to an insane selection. Otherwise the plugin thinks we
            // are still in selection process. I could hack the plugin, but ...
            plot.setSelection({ 'xaxes': { 'from': 0, 'to': 0} });
        }

        function zoomOut() {
            if (zoom_stack.length < 1) {
                return;
            }

            var xaxes_options = plot.getAxes().xaxis.options,
                zoom_level = zoom_stack.pop();

            xaxes_options.min = zoom_level.min;
            xaxes_options.max = zoom_level.max;

            plot.setupGrid();
            plot.draw();
        }

        function onPlotSelected(event, ranges) {
            zoom(ranges.xaxis.from, ranges.xaxis.to);
        }

        function onContextMenu(e) {
            return false;
        }

        function onMouseUp(event) {
            switch (event.which) {
                case 3:
                    // right mouse button pressed
                    if (plot.getSelection() === null) {
                        zoomOut();
                    }
            }
        }

        var update_legend_timeout = null,
            latest_position = null;

        function updateLegend() {
            update_legend_timeout = null;

            var i, j,
                pos = latest_position,
                legends = plot.getPlaceholder().find('.legendLabel'),
                axes = plot.getAxes(),
                dataset = plot.getData();

            if (pos.x < axes.xaxis.min || pos.x > axes.xaxis.max ||
                pos.y < axes.yaxis.min || pos.y > axes.yaxis.max)
                return;

            for (i = 0; i < dataset.length; ++i) {
                var series = dataset[i];

                if (series.data.length < 1) {
                    return;
                }

                // find the nearest points, x-wise
                for (j = 0; j < series.data.length; ++j)
                    if (series.data[j][0] > pos.x)
                        break;

                // interpolate
                var y, p1 = series.data[j - 1], p2 = series.data[j];
                if (p1 == null) {
                    y = p2[1];
                } else if (p2 == null) {
                    y = p1[1];
                } else {
                    y = p1[1] + (p2[1] - p1[1]) * (pos.x - p1[0]) / (p2[0] - p1[0]);
                }

                legends.eq(i).text(series.label.replace(/=.*/, '= ' + y.toFixed(2)));
            }
        }

        function onHover(event, pos, item) {
            latest_position = pos;
            if (!update_legend_timeout)
                update_legend_timeout = setTimeout(updateLegend, 50);
        }

        function bindEvents(plot, eventHolder) {
            eventHolder.mouseup(onMouseUp);
            eventHolder.bind('contextmenu', onContextMenu);
            plot.getPlaceholder().bind('plothover', onHover);
            plot.getPlaceholder().bind('plotselected', onPlotSelected);
            fetchData(plot);
        }

        function shutdown(plot, eventHolder) {
            eventHolder.unbind('mouseup', onMouseUp);
            eventHolder.unbind('contextmenu', onContextMenu);
            plot.getPlaceholder().unbind('plothover', onHover);
            plot.getPlaceholder().unbind('plotselected', onPlotSelected);
        }

        plot.hooks.bindEvents.push(bindEvents);
        plot.hooks.processOptions.push(processOptions);
        plot.hooks.shutdown.push(shutdown);
    }

    $.plot.plugins.push({
        'init': init,
        'options': flot_defaults,
        'name': 'datastream',
        'version': "0.1"
    });

})(jQuery);