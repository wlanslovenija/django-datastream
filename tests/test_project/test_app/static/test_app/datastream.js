(function($) {

    var datastream = {
        'url': 'http://127.0.0.1:8000/api/v1/metric/',

        metricList: function (callback) {
            $.ajax(this.url, {
                dataType: 'json',

                success: function (data, textStatus, jqXHR) {
                    callback(data.objects);
                },

                error: function(jqXHR, textStatus, errorThrown) {
                    alert('error');
                }
            });
        },

        metricName: function (metric) {
            for (var i=0; i < metric.tags.length; i++) {
                if ($.isPlainObject(metric.tags[i]) && 'name' in metric.tags[i]) {
                    return metric.tags[i].name
                }
            }
        },

        plots: {},

        plot: function (selector, metric_id) {

            if ($(selector).children('canvas').length > 0) {

                // if selected existig canvas, add metric
                var plot_id = selector.slice(1);
                var metrics = this.plots[plot_id].addMetric(metric_id);

            } else {

                // else add new plot
                var plot_id = this.nextId();
                $(selector).append('<div id=' + plot_id +
                    ' style="width:400px;height:200px;margin-right: auto; margin-left: auto;"></div>');

                this.plots[plot_id] = $.plot('#' + plot_id, [[]], {
                    datastream: {metrics: [metric_id]},
                    selection: {
                        mode: "x",
                        click: 3
                    },
                    crosshair: { mode: "x" },
                    grid: { hoverable: true, autoHighlight: false },
                    zoom: {
                        interactive: false,
                        trigger: "dblclick",
                        amount: 1.5
                    },
                    pan: {
                        interactive: true,
                        cursor: "move",
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
                });
            }
        },

        _current_id: 0,

        nextId: function () {
            this._current_id += 1;
            return 'plot_' + this._current_id;
        },

        currentId: function () {
            return 'plot_' + this._current_id;
        }

    };

    var options = {
        datastream: null
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

                plot.getAxes().xaxis.options.mode = "time";
                plot.getAxes().xaxis.options.ticks = Math.floor(plot.getPlaceholder().width() / 75);
                //plot.getAxes().xaxis.options.timeformat = "%y/%m/%d";

                //plot.hooks.processDatapoints.push(fetchData);
                fetchData(plot, s);
            }
        }

        plot.hooks.processOptions.push(processOptions);

        function updateData(plot, data) {
            var newpoints = [],
                i = 0;

            for (i; i < data.datapoints.length; i += 1) {
                newpoints.push([(new Date(data.datapoints[i].t)).getTime(),
                    data.datapoints[i].v]);
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
            $.ajax(datastream.url + metric + '/?g=s', {
                dataType: 'json',

                success: function (data, textStatus, jqXHR) {
                    updateData(plot, data);
                },

                error: function(jqXHR, textStatus, errorThrown) {
                    alert('error');
                }
            });
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

        plot.getPlaceholder().bind("plotselected", function (event, ranges) {
            zoom(ranges.xaxis.from, ranges.xaxis.to);
        });

        plot.getPlaceholder().bind("contextmenu", function(e) {
            return false;
        });

        plot.getPlaceholder().mouseup(function(event) {
            switch (event.which) {
                case 3:
                    // right mouse button pressed
                    if (plot.getSelection() === null) {
                        zoomOut();
                    }
            }
        });

        var update_legend_timeout = null,
            latest_position = null;

        function updateLegend() {
            update_legend_timeout = null;

            var pos = latest_position;

            var axes = plot.getAxes();
            if (pos.x < axes.xaxis.min || pos.x > axes.xaxis.max ||
                pos.y < axes.yaxis.min || pos.y > axes.yaxis.max)
                return;

            var i, j, dataset = plot.getData();
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

                var legends = plot.getPlaceholder().find('.legendLabel');
                legends.eq(i).text(series.label.replace(/=.*/, "= " + y.toFixed(2)));
            }
        }

        plot.getPlaceholder().bind("plothover",  function (event, pos, item) {
            latest_position = pos;
            if (!update_legend_timeout)
                update_legend_timeout = setTimeout(updateLegend, 50);
        });
    }

    $.plot.plugins.push({
        init: init,
        options: options,
        name: 'datastream',
        version: '0.1'
    });

    window.datastream = datastream;
})(jQuery);