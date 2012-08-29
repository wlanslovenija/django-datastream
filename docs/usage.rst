Usage
=====

For this document we assume that API is nested under /api/ URL prefix.

List of all metrics can be obtained at::

    /api/v1/metric/

Accessing particular metric is through its ID::

    /api/v1/metric/caa88489-fa0f-4458-bc0b-0d52c7a31715/

Together with some metadata also datapoints are returned as a list of
t (time) and v (value) dictionaries. Which data is returned can be configured
with query parameters::

    g - granularity (s, m, h, and d, for seconds, minutes, hours, and days, respectively)
    s - start time (in a number of seconds from UNIX epoch)
    e - end time (in a number of seconds from UNIX epoch)
    d - downsamplers, you can specify them to limit returned downsampled values to only
    those, can be a comma-separated list or specified multiple times in the query; possible
    values are same as downsamplers' keys

For example, query to return minutes granularity with only average, min, and max values, could be::

    /api/v1/metric/caa88489-fa0f-4458-bc0b-0d52c7a31715/?g=m&d=m,l&d=u

