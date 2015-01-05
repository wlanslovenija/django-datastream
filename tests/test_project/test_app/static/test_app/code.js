$(document).ready(function () {
    $(document).ajaxError(function (event, jqXHR, ajaxSettings, thrownError) {
        console.error(event, jqXHR, ajaxSettings, thrownError);
    });

    // TODO: Will load only the first page of streams
    $('#charts').datastream();
});
