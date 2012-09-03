$(document).ready(function() {

    $('#addmetric').click(function() {
        datastream.plot('#' + datastream.currentId(), $('#selectmetric').val());
    });

    $('#addplot').click(function() {
        datastream.plot('#placeholder', $('#selectmetric').val());
    });

    datastream.metricList(function(metrics) {
        $('select#selectmetric option').remove();
        $.each(metrics, function(i, metric) {
            var row = '<option value="' + metric.id + '">' + datastream.metricName(metric) + '</option>';
            $(row).appendTo('select#selectmetric');
        });

        datastream.plot('#placeholder', $('#selectmetric').val());
    });

});

