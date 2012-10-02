(function($, undefined) {

    var debug,
        plots = {},
        cached_data = {},
        current_plot_id = 0,
        datastream_location = '',
        restful_api_location = 'api/v1/metric/',
        query_in_progress = false,
        plot_redrawing = false;

    function toDebugTime (miliseconds) {
        function twoDigits(digit) {
            return ("0" + digit).slice(-2);
        }

        var d = new Date();
        d.setTime(miliseconds);
        return twoDigits(d.getHours()) + ':' +
            twoDigits(d.getMinutes()) + ':' +
            twoDigits(d.getSeconds()) + ' ' +
            twoDigits(d.getDate()) + '.' +
            twoDigits(d.getMonth() + 1) + '.' +
            d.getFullYear();
    }

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
        datastream_location = document.createElement('a');
        datastream_location.href = "";
        datastream_location = datastream_location.href + restful_api_location;
    }

    function Datastream(placeholder, options) {

        var self = this,
            add_metric = null;

        if (options && options.metrics) {
            options = $.extend(options, { 'datastream': {'metrics': options.metrics }});
            delete options.metrics;
        }

        if (options && options.add_metric) {
            add_metric = options.add_metric;
            delete options.add_metric;
        }

        self.options = $.extend({}, $.datastream.defaults, options);
        self.placeholder = placeholder;

        if (placeholder.children('canvas') && add_metric) {

            // if selected existig canvas, add metric
            var plot_id = placeholder.prop('id');
            self.options.datastream.metrics.push(add_metric);
            plots[plot_id].addMetric(add_metric);

        } else {

            // else add new plot
            var plot_id = $.datastream.nextId();
            placeholder.append($('<div>', {
                'id': plot_id,
                'style': 'width:' + self.options.width + 'px; ' +
                'height:' + self.options.height + 'px'
            }));

            plots[plot_id] = $.plot('#' + plot_id, [[]], self.options);
        }
    }

    $.datastream = {};

    $.fn.datastream = function (options) {
        return this.each(function () {
            new Datastream($(this), options);
        });
    };

    $.datastream.metricList = function (callback) {
        $.getJSON($.datastream.defaults.url, function (data, status) {
            callback(data.objects);
        });
    };

    $.datastream.metricName = function (metric) {
        var name_tag = $.grep(metric.tags, function (val, i) { return val.name; });
        return (name_tag.length) ? name_tag[0].name : undefined;
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
        'granularity': null,
        'from': null,
        'to': null,
        'datastream': {
            'metrics': []
        },
        'selection': {
            'mode': 'x',
            'click': 3
        },
        'crosshair': {
            'mode': 'x'
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
        },
        'series': {
            'lines': {
                'lineWidth': 1
            }
        }
    };

    var flot_defaults = {
        'url': datastream_location,
        'datastream': null,
        'from': null,
        'to': null
    };

    function getMetricData(metric_id, granularity, from, to, callback) {
        if (query_in_progress) {
            setTimeout(function () { getMetricData(metric_id, granularity, from, to, callback); }, 40);
            return;
        }

        if (!cached_data[metric_id]) {
            cached_data[metric_id] = {};
        }

        var intervals = [],
            collection = (cached_data[metric_id][granularity]) ?
                cached_data[metric_id][granularity] : null;

        if (from >= to) {
            throw new Error("Argument Error: argument from must be less than argument to.");
        }

        intervals.push([from, to]);

        // check intersections of requested data with local data
        if (collection !== null) {
            $.each(collection, function (i, c) {
                var add = [];

                intervals = $.grep(intervals, function (interval, j) {
                    var f = interval[0],
                        t = interval[1];

                    if (f <= c.points_to && t >= c.points_from) {
                        // requested data intersects with given interval

                        if (f < c.points_from && t > c.points_to) {
                            // requested data interval larger than given
                            add.push([f, c.points_from]);
                            add.push([c.points_to, t]);
                        } else if (f < c.points_from) {
                            // requested data interval is to the left of given
                            add.push([f, c.points_from]);
                        } else if (t > c.points_to) {
                            // requested data interval is to the right of given
                            add.push([c.points_to, t]);
                        }
                        return false;
                    }
                    return true;
                });

                intervals = intervals.concat(add);

                // if requested data is in local data
                if (intervals.length === 0) {
                    return false;
                }
            });
        }

        function selectData() {
            // return some data (even if not all is received yet)
            var data = {},
                points = [],
                collection = cached_data[metric_id][granularity];

            function bisectPoints(val, arr) {
                var h, i = 0,
                    j = arr.length;

                while (i < j) {
                    h = Math.floor((i + j) / 2);
                    if (val > arr[h][0]) {
                        i = h + 1;
                    } else {
                        j = h;
                    }
                }
                return i;
            }

            if (!collection || !$.isArray(collection) || collection.length === 0) {
                throw new Error('The collection should never be null or empty here, ever! Something is very, very wrong.');
            }

            collection.sort(function (a, b) { return a.query_from - b.query_from });

            $.each(collection, function (i, c) {
                if (from <= c.query_to && to >= c.query_from) {
                    // requested data intersects with collection
                    var f = (from < c.query_from) ? c.query_from : from,
                        t = (to > c.query_to) ? c.query_to : to,
                        i = bisectPoints(f, c.data),
                        j = bisectPoints(t, c.data);

                    points = points.concat(c.data.slice(i, j));
                }
            });

            data.data = points;
            data.label = collection[0].label;
            data.from = from;
            data.to = to;

            callback(data);
        }

        if (collection) {
            // show local data first, add more data to the plot when received
            selectData();
        }

        if (intervals.length) {
            $.each(intervals, function (i, interval) {
                var from = interval[0],
                    to = interval[1];

                var get_url = $.datastream.defaults.url + metric_id,
                    params = {
                        'g': granularity,
                        's': Math.floor(from / 1000).toString(),
                        'e': Math.floor(to / 1000).toString(),
                        'd': 'm'
                    };

                console.debug('GET ' + get_url);

                query_in_progress = true;
                $.getJSON(get_url, params,
                    function (data) {
                        var t, v, j, k, p_f, p_t, first, last,
                            points = [],
                            processed_data = {},
                            label = $.datastream.metricName(data) + ' = ?',
                            new_interval = true,
                            update = true,
                            collection = (cached_data[metric_id][granularity]) ?
                                cached_data[metric_id][granularity] : null;

                        if (debug) {
                            debug.find('#debugTable tr:last').after($('<tr>')
                                .append($('<td>').html($.datastream.metricName(data)))
                                .append($('<td>').html(granularity))
                                .append($('<td>').html(toDebugTime(from)))
                                .append($('<td>').html(toDebugTime(to)))
                                .append($('<td>').html(data.datapoints.length))
                            );
                        }

                        if (!data.datapoints) {
                            return;
                        }

                        // format data points; we use for because it runs faster
                        // than each and we might have thousands of points here
                        for (j = 0; j < data.datapoints.length; j += 1) {
                            t = data.datapoints[j].t;
                            v = data.datapoints[j].v;

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

                            points.push([t, v]);
                        }

                        // time of first and last point
                        first = data.datapoints[0];
                        last = data.datapoints[data.datapoints.length - 1];
                        if ($.isPlainObject(first.t)) {
                            p_f = new Date(first.t.z).getTime();
                            p_t = new Date(last.t.z).getTime();
                        } else {
                            p_f = new Date(first.t).getTime();
                            p_t = new Date(last.t).getTime();
                        }

                        // add to cache
                        if (!cached_data[metric_id][granularity]) {
                            cached_data[metric_id][granularity] = [];
                        } else {
                            $.each(collection, function(j, c) {
                                k = 0;
                                // concatenate with an existing interval if possible
                                if (c.points_from === to) {
                                    if (points.length === 1 &&
                                        points[0][0] === c.data[0][0] &&
                                        points[0][1] === c.data[0][1]) {
                                        update = false;
                                        return false;
                                    }
                                    // remove overlapping points
                                    while (k < c.data.length) {
                                        if (points[points.length - 1][0] >= c.data[k][0]) {
                                            k += 1;
                                        } else {
                                            break;
                                        }
                                    }
                                    c.data = points.concat(c.data.slice(k));
                                    c.query_from = from;
                                    c.points_from = p_f;
                                    new_interval = false;

                                } else if (c.points_to === from) {
                                    if (points.length === 1 &&
                                        points[0][0] === c.data[c.data.length - 1][0] &&
                                        points[0][1] === c.data[c.data.length - 1][1]) {
                                        update = false;
                                        return false;
                                    }
                                    // remove overlapping points
                                    while (k < c.data.length) {
                                        if (points[0][0] <= c.data[c.data.length - 1 - k][0]) {
                                            k += 1;
                                        } else {
                                            break;
                                        }
                                    }
                                    c.data = c.data.slice(0, c.data.length - k).concat(points);
                                    c.query_to = to;
                                    c.points_to = p_t;
                                    new_interval = false;
                                }
                            });
                        }

                        if (update) {
                            if (new_interval) {
                                processed_data.data = points;
                                processed_data.label = label;
                                processed_data.query_from = from;
                                processed_data.query_to = to;
                                processed_data.points_from = p_f;
                                processed_data.points_to = p_t;
                                cached_data[metric_id][granularity].push(processed_data);
                            }

                            selectData();
                        }
                    }
                ).complete(function () {
                        query_in_progress = false;
                    }
                );
            });
        }
    }

    function init(plot) {
        var enabled = false,
            metrics = [],
            zoom_stack = [],
            granularity = [
                {'name': "Seconds",    'key': 's',   'span': 1},
                {'name': "10 Seconds", 'key': '10s', 'span': 10},
                {'name': "Minutes",    'key': 'm',   'span': 60},
                {'name': "10 Minutes", 'key': '10m', 'span': 600},
                {'name': "Hours",      'key': 'h',   'span': 3600},
                {'name': "6 Hours",    'key': '6h',  'span': 21600},
                {'name': "Days",       'key': 'd',   'span': 86400}
            ],
            mode = 0;

        plot.metrics = function() {
            return metrics;
        };

        function processOptions(plot, s) {
            if (s.datastream) {
                enabled = true;
                metrics = s.datastream.metrics;

                if (s.to === null) {
                    s.to = new Date().getTime();
                } else if (jQuery.type(s.to) === 'date') {
                    s.to = s.to.getTime();
                }

                if (s.granularity === null) {
                    s.granularity = 2;
                }

                if (s.from !== null) {
                    mode = 1;
                }

                if (s.from === null) {
                    s.from = s.to - plot.getPlaceholder().width() * granularity[s.granularity].span * 1000;
                } else if (jQuery.type(s.from) === 'date') {
                    s.from = s.from.getTime();
                }

                s.HtmlText = true;
                s.title = "My Plot";

                plot.getAxes().xaxis.options.mode = 'time';
                plot.getAxes().xaxis.options.ticks = Math.floor(plot.getPlaceholder().width() / 75);
            }
        }

        function updateData(data) {
            var new_metric = true,
                new_data = [],
                o = plot.getOptions(),
                xaxes_options = plot.getAxes().xaxis.options;

            $.each(plot.getData(), function(key, val) {
                if (val.data.length !== 0) {
                    if (val.label === data.label) {
                        new_data.push(data);
                        new_metric = false;
                    } else {
                        new_data.push({'data': val.data, 'label': val.label});
                    }
                    delete val.data;
                }
            });

            if (new_metric) {
                new_data.push(data);
            }

            plot.setData(new_data);
            xaxes_options.min = o.from;
            xaxes_options.max = o.to;
            plot.setupGrid();
            plot.draw();
        }

        plot.addMetric = function(metric) {
            var i,
                o = plot.getOptions(),
                gr = granularity[o.granularity].key,
                span = (o.to - o.from);

            if (mode === 1) {
                // if alternative mode, find the best granularity
                for (i = 0; i < granularity.length; i++) {
                    if (span / 1000 / granularity[i].span < 2 * o.width) {
                        break;
                    }
                }
                i = (i > 0) ? i - 1 : i;
                gr = granularity[i].key;
            }

            if ($.inArray(metric, o.datastream.metrics) < 0) {
                o.datastream.metrics.push(metric);
            }

            getMetricData(metric, gr, o.from - Math.floor(span / 2),
                o.to + Math.floor(span / 2), function (data) {
                updateData(data);
            });
        };

        function update() {
            $.each(metrics, function(key, val) {
                plot.addMetric(val);
            });
        }

        function zoom(from, to) {
            var o = plot.getOptions(),
                xaxes_options = plot.getAxes().xaxis.options;

            zoom_stack.push({
                'min': xaxes_options.min,
                'max': xaxes_options.max,
                'granularity': o.granularity
            });

            mode = 1;
            o.from = from;
            o.to = to;

            plot.clearSelection();
            update();

            // Stupid work-around. For crosshair to work we must set selection
            // plugin to an insane selection. Otherwise the plugin thinks we
            // are still in selection process. We could hack the plugin, but it
            // is not polite to play with other people's toys.
            plot.setSelection({ 'xaxes': { 'from': 0, 'to': 0} });
        }

        function zoomOut() {
            if (zoom_stack.length < 1) {
                return;
            }

            var o = plot.getOptions(),
                zoom_level = zoom_stack.pop();

            o.from = zoom_level.min;
            o.to = zoom_level.max;
            o.granularity = zoom_level.granularity;
            update();
        }

        function onPlotSelected(event, ranges) {
            zoom(ranges.xaxis.from, ranges.xaxis.to);
        }

        function onContextMenu() {
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

            // we use for because it runs faster than each and we might have
            // thousands of points here
            for (i = 0; i < dataset.length; ++i) {
                var series = dataset[i];

                if (series.data.length < 1) {
                    return;
                }

                // find the nearest points, x-wise; we use for because it runs
                // faster than each and we might have thousands of points here
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

        function onHover(event, pos) {
            latest_position = pos;
            if (!update_legend_timeout)
                update_legend_timeout = setTimeout(updateLegend, 50);
        }

        function onPan() {
            var o = plot.getOptions(),
                xaxes_options = plot.getAxes().xaxis.options;

            if (Math.abs(o.from - xaxes_options.min) / (xaxes_options.max - xaxes_options.min) > 0.3) {
                o.from = xaxes_options.min;
                o.to = xaxes_options.max;
                console.debug("FETCH min: " + toDebugTime(xaxes_options.min) + " max: " + toDebugTime(xaxes_options.max));

                update();
            }
        }

        function onScroll(event, delta, deltaX, deltaY) {
            var o = plot.getOptions(),
                xaxes_options = plot.getAxes().xaxis.options;

            function changeGranularity(delta) {
                zoom_stack = [];
                if (mode === 1) {
                    var time_span = xaxes_options.max - xaxes_options.min,
                        theoretic_time_span = plot.width() * granularity[o.granularity].span * 1000;

                    if ((time_span - theoretic_time_span) * delta > 0) {
                        if (o.granularity + delta >= 0 && o.granularity + delta < granularity.length) {
                            o.granularity += delta;
                        }
                    }
                    mode = 0;

                } else {
                    if (o.granularity + delta < 0 || o.granularity + delta >= granularity.length) {
                        return;
                    }
                    o.granularity += delta;
                }

                o.to = xaxes_options.max;
                o.from = o.to - plot.width() * granularity[o.granularity].span * 1000;
                plot_redrawing = true;
                update();

                setTimeout(function () {
                    plot_redrawing = false;
                }, 300);
            }

            if (!plot_redrawing && deltaY > 0.1) {
                changeGranularity(1);

            } else if (!plot_redrawing && deltaY < -0.1) {
                changeGranularity(-1);

            } else if (deltaX != 0) {
                var frame_rate = o.pan.frameRate;
                if (plot_redrawing || !frame_rate) {
                    return false;
                }

                plot_redrawing = true;
                setTimeout(function () {
                    plot.pan({ left: -deltaX * 40, top: 0 });
                    plot_redrawing = false;
                }, 1 / frame_rate * 1000);
            }

            return false;
        }

        function bindEvents(plot, eventHolder) {
            eventHolder.mouseup(onMouseUp)
                       .bind('contextmenu', onContextMenu);

            plot.getPlaceholder().bind('plothover', onHover)
                                 .bind('plotselected', onPlotSelected)
                                 .bind('plotpan', onPan)
                                 .bind('mousewheel', onScroll);
            update();
        }

        function shutdown(plot, eventHolder) {
            eventHolder.unbind('mouseup', onMouseUp)
                       .unbind('contextmenu', onContextMenu);

            plot.getPlaceholder().unbind('plothover', onHover)
                                 .unbind('plotselected', onPlotSelected)
                                 .bind('plotpan', onPan)
                                 .unbind('mousewheel', onScroll);
        }

        plot.hooks.bindEvents.push(bindEvents);
        plot.hooks.processOptions.push(processOptions);
        plot.hooks.shutdown.push(shutdown);
    }

    $.plot.plugins.push({
        'init': init,
        'options': flot_defaults,
        'name': 'datastream',
        'version': '0.1'
    });

})(jQuery);