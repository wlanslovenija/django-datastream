$(document).ready(function () {
    var to = new Date();
    var from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (!$('#debug').length) {
        $(document).ajaxError(function (event, jqXHR, ajaxSettings, thrownError) {
            window.console.error(event, jqXHR, ajaxSettings, thrownError);
            alert("Oops, something went wrong...");
        });
    }

    $('#addstream').click(function (event) {
        var plots = $('#placeholder').children(':last').datastream({
            'add_stream': $('#selectstream').val()
        });
    });

    $('#addplot').click(function (event) {
        $('#placeholder').datastream({
            'to': to,
            'streams': [
                $('#selectstream').val()
            ]
        });
    });

    $('#addstream_alt').click(function (event) {
        var plots = $('#placeholder_alt').children(':last').datastream({
            'add_stream': $('#selectstream_alt').val()
        });
    });

    $('#addplot_alt').click(function (event) {
        $('#placeholder_alt').datastream({
            'from': from,
            'to': to,
            'streams': [
                $('#selectstream_alt').val()
            ]
        });
    });

    $.datastream.streamList(function (streams) {
        $('#selectstream option, #selectstream_alt option').remove();

        $.each(streams, function (i, stream) {
            $('#selectstream').append($('<option>').attr({
                'value': stream.id
            }).text($.datastream.streamName(stream)));
        });

        $.each(streams, function (i, stream) {
            $('#selectstream_alt').append($('<option>').attr({
                'value': stream.id
            }).text($.datastream.streamName(stream)));
        });

        $('#placeholder').datastream({
            'to': to,
            'streams': [
                $('#selectstream').val()
            ]
        });

        $('#placeholder_alt').datastream({
            'from': from,
            'to': to,
            'streams': [
                $('#selectstream_alt').val()
            ]
        });
    });
});