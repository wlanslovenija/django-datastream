(function($, undefined) {

    var current_plot_id = 0;

    var datastream = {
        "url": 'http://127.0.0.1:8000/api/v1/metric/',

        metricList: function (callback) {
            $.getJSON(this.url, function (data) {
                    callback(data.objects);
                }
            );
        },

        metricName: function (metric) {
            var name_tag = $(metric).attr("tags").filter(function (o) { return o.name; });
            return (name_tag.length > 0) ? name_tag[0].name : undefined;
        },

        plots: {},

        plot: function (selector, metric_id, options) {

            var settings = $.extend({
                url: this.url,
                width: 400,
                height: 200,
                from: null,
                to: null,
                datastream: {
                    metrics: [metric_id]
                },
                selection: {
                    mode: "x",
                    click: 3
                },
                crosshair: {
                    mode: "x"
                },
                grid: {
                    hoverable: true,
                    autoHighlight: false
                },
                zoom: {
                    interactive: false,
                    trigger: 'dblclick',
                    amount: 1.5
                },
                pan: {
                    interactive: true,
                    cursor: 'move',
                    frameRate: 20
                },
                xaxis: {
                    zoomRange: null,
                    panRange: null
                },
                yaxis: {
                    zoomRange: false,
                    panRange: false
                }
            }, options);

            if ($(selector).children('canvas').length > 0) {

                // if selected existig canvas, add metric
                var plot_id = selector.slice(1);
                var metrics = this.plots[plot_id].addMetric(metric_id);

            } else {

                // else add new plot
                var plot_id = this.nextId();
                $(selector).append('<div ' + 'id=\'' + plot_id + '\' ' +
                    'style=\'width:' + settings.width + 'px; ' +
                    'height:' + settings.height + 'px\'></div>');

                this.plots[plot_id] = $.plot('#' + plot_id, [[]], settings);
            }
        },

        nextId: function () {
            current_plot_id += 1;
            return 'plot_' + current_plot_id;
        },

        currentId: function () {
            return 'plot_' + current_plot_id;
        }

    };

    var options = {
        url: 'http://127.0.0.1:8000/api/v1/metric/',
        datastream: null,
        from: null,
        to: null
    };

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
                } else if (jQuery.type(settings.from) === 'date') {
                    s.from = Math.floor(s.from.getTime() / 1000.0)
                }

                plot.getAxes().xaxis.options.mode = 'time';
                plot.getAxes().xaxis.options.ticks = Math.floor(plot.getPlaceholder().width() / 75);

                fetchData(plot, s);
            }
        }

        function updateData(plot, data) {
            var t, v,
                newpoints = [],
                i = 0;

            for (i; i < data.datapoints.length; i += 1) {
                t = data.datapoints[i].t;
                v = data.datapoints[i].v;

                if ($.isPlainObject(t)) {
                    t = new Date(t['a']).getTime();
                } else {
                    t = new Date(t).getTime();
                }

                if ($.isPlainObject(v)) {
                    v = v['m'];
                } else {
                    v = v;
                }

                newpoints.push([t, v]);
            }

            var new_data = [];
            $.each(plot.getData(), function(key, val) {
                if (val.data.length !== 0) {
                    new_data.push({data: val.data, label: val.label});
                    delete val.data;
                }
            });
            new_data.push({data: newpoints, label: datastream.metricName(data) + ' = ?'});

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

            $.getJSON(o.url + metric + '/?g=' + gr[i] + '&s=' + o.from + '&e=' + o.to + '&d=m',
                function (data) {
                    updateData(plot, data);
                }
            );
        };

        function fetchData(plot, s) {

            $.each(metrics, function(key, val) {
                plot.addMetric(val);
            });
        }

        function zoom(from, to) {
            var xaxes_options = plot.getAxes().xaxis.options;
            zoom_stack.push({min: xaxes_options.min, max: xaxes_options.max});
            xaxes_options.min = from;
            xaxes_options.max = to;

            plot.clearSelection();
            plot.setupGrid();
            plot.draw();

            // Stupid work-around. For crosshair to work we must set selection
            // plugin to an insane selection. Otherwise the plugin thinks we
            // are still in selection process. I could hack the plugin, but ...
            plot.setSelection({ xaxes: { from: 0, to: 0} });
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
        init: init,
        options: options,
        name: 'datastream',
        version: "0.1"
    });

    window.datastream = datastream;
})(jQuery);