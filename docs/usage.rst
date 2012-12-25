Usage
=====

.. note::

    For this document we assume that API is nested under ``/api/`` URL prefix.

API resembles RESTful interface, allowing for example to specify response data format (JSON, XML, ...).

List of all streams can be obtained at::

    /api/v1/stream/

Accessing particular stream is through its ID, for example::

    /api/v1/stream/caa88489-fa0f-4458-bc0b-0d52c7a31715/

API is read-only and supports the following HTTP commands for each stream:

* ``GET`` -- returns data
* ``WAIT`` -- waits for any data to be available and returns it

``GET`` and ``WAIT`` can be seen as non-blocking and blocking counterparts of each other, respectively.
Otherwise they behave the same. They return a list of datapoints stored in a stream. Response contains
some additional metadata to allow pagination and automatic interface exploration/discovery easier.

Because of potentially long streames, additional parameters can be specified to limit the interval of
datapoints through query string parameters (default is all datapoints)::

    /api/v1/stream/caa88489-fa0f-4458-bc0b-0d52c7a31715/?s=<start timestamp>&e=<end timestamp>

Timestamps are in seconds since `UNIX epoch`_. If start or end timestamp is missing, this means all
datapoints from the beginning of the stream, or all datapoints to the end of the stream, respectively.
For real-time streams the latter in practice means all datapoints until the current time. Start and end
timestamps are inclusive.

Additionally, paging query string parameters can be used::

    /api/v1/stream/caa88489-fa0f-4458-bc0b-0d52c7a31715/?l=<page limit>&o=<offset>

Page limit limits absolute number of datapoints returned in this response and offset allows offsetting the datapoints,
positive from beginning, negative from the end. Metadata in the response contains data on how many datapoints would
there be otherwise in the response and URIs to previous and next page. Setting page limit to 0 allows simple
querying of the URI without retrieving any data. Default page limit is 100 datapoints.

``WAIT`` waits until any datapoint in stream (possibly limited by query string parameters) is available before
returning. If data is already available, it returns immediately, behaving the same as ``GET``. For example, after
reading all datapoints of a stream, client can request ``WAIT`` request with ``s`` parameter set to the timestamp of the
last datapoint to wait until new datapoint is added to the stream.

Together with some metadata datapoints are returned as a list of ``t`` (time) and ``v`` (value) dictionaries.
Which data is returned can be configured with query parameters:

* ``g`` -- granularity (``s``, ``10s``, ``m``, ``10m``, ``h``, ``6h``, and ``d``, for seconds, 10 seconds, minutes,
  10 minutes, hours, 6 hours, and days, respectively)
* ``v`` -- value downsamplers, you can specify them to limit returned downsampled values; a comma-separated
  list or specified multiple times in the query
* ``t`` -- time downsamplers, you can specify them to limit returned downsampled timestamps; a comma-separated
  list or specified multiple times in the query

For example, to return minutes granularity with only average, min, and max values::

    /api/v1/stream/caa88489-fa0f-4458-bc0b-0d52c7a31715/?g=m&d=m,l&d=u

.. _UNIX epoch: http://en.wikipedia.org/wiki/Unix_time

Datastream server
-----------------

To serve datastreams production-grade HTTP server is bundled in. It is scalable and non-blocking, based on
`Tornado webserver`_. It supports thousands of simultaneous standing connections waiting for new datapoints.
Along with serving datastream API requests it can be also used as a replacement for Django's `runserver
management command`_ (but it does not `autoserve static files`_, you have to `collect static files`_
beforehand, and does not autoreload on code changes). You run it in a similar way with::

    ./manage.py rundataserver

This is needed to support ``WAIT`` command. If you are not using it, you can serve Django in a standard way.

.. _Tornado webserver: http://www.tornadoweb.org/
.. _runserver management command: https://docs.djangoproject.com/en/dev/ref/django-admin/#runserver-port-or-address-port
.. _autoserve static files: https://docs.djangoproject.com/en/dev/ref/contrib/staticfiles/#staticfiles-runserver
.. _collect static files: https://docs.djangoproject.com/en/dev/ref/contrib/staticfiles/#django-admin-collectstatic

Demo web page
-------------

For a demo web page, start mongo database, go to the tests folder and run::

    ./manage.py dummydatastream -t "int(0,100),float(0,3),float(-2,2),enum(1,2,3)" -v 2

This runs a deamon that creates test stream data. Three data types are supported
(int, float and enum). Rfange can be specified within brackets for int and float and
a list of values for the enum data type.

Open new terminal window, cd to tests folder again and run mongo project::

    ./manage.py rundataserver

Open the `demo web page`_.

.. _demo web page: http://127.0.0.1:8000/
