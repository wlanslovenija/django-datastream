(function($) {

    var datastream = {
        'url': 'http://127.0.0.1:8000/api/v1/metric/',

        'metricList': function(callback) {
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

        'metricName': function(metric) {
            for (var i=0; i < metric.tags.length; i++) {
                if ($.isPlainObject(metric.tags[i]) && 'name' in metric.tags[i]) {
                    return metric.tags[i].name
                }
            }
        },

        'plots': {},

        'plot': function(selector, metricId) {

            if ($(selector).children('canvas').length > 0) {

                // if selected existig canvas, add metric
                var plotId = selector.slice(1);
                var metrics = this.plots[plotId].addMetric(metricId);

            } else {

                // else add new plot
                var plotId = this.nextId();
                $(selector).append('<div id=' + plotId +
                    ' style="width:300px;height:200px;margin-right: auto; margin-left: auto;"></div>');

                this.plots[plotId] = $.plot('#' + plotId, [[]], { 'datastream': {'metrics': [metricId]} });
            }
        },

        '_currentId': 0,

        nextId: function () {
            this._currentId += 1;
            return 'plot_' + this._currentId;
        },

        currentId: function () {
            return 'plot_' + this._currentId;
        }

    };

    var options = {
        datastream: null
    };

    function init(plot) {
        var enabled = false,
            metrics = [];

        plot.metrics = function() { return metrics; };

        function updateData(plot, data) {
            var newpoints = [],
                i = 0;

            for (i; i < data.datapoints.length; i += 1) {
                newpoints.push([(new Date(data.datapoints[i].t)).getTime(),
                    data.datapoints[i].v]);
            }

            var newData = [];
            $.each(plot.getData(), function(key, val) {
                if (val.data.length !== 0) {
                    newData.push(val.data);
                    delete val.data;
                }
            });
            newData.push(newpoints);

            plot.setData(newData);
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

            //var ps = datapoints.pointsize, i, x, y;
            //var origpoints = datapoints.points;
            //var prev_y;
        }

        function checkEnabled(plot, s) {
            if (s.datastream) {
                enabled = true;
                metrics = s.datastream.metrics;

                plot.getAxes().xaxis.options.mode = "time";
                //plot.getAxes().xaxis.options.timeformat = "%y/%m/%d";

                //plot.hooks.processDatapoints.push(fetchData);
                fetchData(plot, s);
            }
        }

        plot.hooks.processOptions.push(checkEnabled);
    }

    $.plot.plugins.push({
        init: init,
        options: options,
        name: 'datastream',
        version: '0.1'
    });

    window.datastream = datastream;
})(jQuery);