import calendar
import collections
import datetime
import decimal
import os
import rfc822
import sys
import unittest
import urllib

from django.core import management
from django.utils import timezone, translation

import ujson

from tastypie import serializers as tastypie_serializers

from django_datastream import datastream, resources, serializers, test_runner

try:
    # Available since Django 1.7.
    from django.apps import apps
except ImportError:
    apps = None

if hasattr(timezone, 'get_fixed_timezone'):
    # Available since Django 1.7.
    get_fixed_timezone = timezone.get_fixed_timezone
else:
    # Copied from Django 1.7.

    class FixedOffset(datetime.tzinfo):
        def __init__(self, offset=None, name=None):
            if offset is not None:
                self.__offset = datetime.timedelta(minutes=offset)
            if name is not None:
                self.__name = name

        def utcoffset(self, dt):
            return self.__offset

        def tzname(self, dt):
            return self.__name

        def dst(self, dt):
            return datetime.timedelta(0)

    def get_fixed_timezone(offset):
        if isinstance(offset, datetime.timedelta):
            offset = offset.seconds // 60
        sign = '-' if offset < 0 else '+'
        hhmm = '%02d%02d' % divmod(abs(offset), 60)
        name = sign + hhmm
        return FixedOffset(offset, name)


# From Python 3.3 email.utils.parsedate_to_datetime.
def parsedate_to_datetime(data):
    if not data:
        return None
    dtuple = rfc822.parsedate_tz(data)
    tz = dtuple[-1]
    dtuple = dtuple[:-1]
    if tz is None:
        return datetime.datetime(*dtuple[:6])
    return datetime.datetime(*dtuple[:6], tzinfo=get_fixed_timezone(datetime.timedelta(seconds=tz)))


class BasicTest(test_runner.ResourceTestCase):
    @classmethod
    def setUpClass(cls):
        super(BasicTest, cls).setUpClass()

        cls.value_downsamplers = datastream.backend.value_downsamplers
        cls.time_downsamplers = datastream.backend.time_downsamplers

        # We first remove all streams.
        datastream.delete_streams()

        # And then create 4.
        management.execute_from_command_line([sys.argv[0], 'dummystream', '--types=int(0,10),float(-2,2),float(0,100),enum(a,b,c)', '--span=1h', '--no-real-time'])

        cls.streams = [datastream.Stream(stream) for stream in datastream.find_streams()]

        for stream in cls.streams:
            # We have to convert these to unicode strings for tests to work.
            stream.highest_granularity = unicode(stream.highest_granularity)
            stream.value_downsamplers = [unicode(value_downsampler) for value_downsampler in stream.value_downsamplers]
            stream.time_downsamplers = [unicode(time_downsampler) for time_downsampler in stream.time_downsamplers]

    def assertEqualDatapoints(self, stream_datapoints, offset, limit, datapoints, message):
        if limit == 0:
            stream_datapoints = []
        else:
            stream_datapoints = stream_datapoints[offset:offset + limit]

        for datapoint in datapoints:
            if isinstance(datapoint['t'], collections.Mapping):
                for key, value in datapoint['t'].iteritems():
                    datapoint['t'][key] = parsedate_to_datetime(value).utctimetuple()
            else:
                datapoint['t'] = parsedate_to_datetime(datapoint['t']).utctimetuple()

        stream_datapoints = list(stream_datapoints)
        for datapoint in stream_datapoints:
            if isinstance(datapoint['t'], collections.Mapping):
                for key, value in datapoint['t'].iteritems():
                    datapoint['t'][key] = value.utctimetuple()
            else:
                datapoint['t'] = datapoint['t'].utctimetuple()
            if isinstance(datapoint['v'], collections.Mapping):
                for key, value in datapoint['v'].iteritems():
                    if isinstance(value, decimal.Decimal):
                        datapoint['v'][key] = str(value)
            else:
                if isinstance(datapoint['v'], decimal.Decimal):
                    datapoint['v'] = str(datapoint['v'])

        self.assertEqual(stream_datapoints, datapoints)

    def test_api_uris(self):
        # URIs have to be stable.

        self.assertEqual('/api/v1/stream/', self.resource_list_uri('stream'))
        self.assertEqual('/api/v1/stream/schema/', self.resource_schema_uri('stream'))

    def test_read_only(self):
        stream_uri = '%s%s/' % (self.resource_list_uri('stream'), self.streams[0].id)

        self.assertHttpMethodNotAllowed(self.api_client.post(self.resource_list_uri('stream'), format='json', data={}))
        self.assertHttpMethodNotAllowed(self.api_client.put(stream_uri, format='json', data={}))
        self.assertHttpMethodNotAllowed(self.api_client.patch(stream_uri, format='json', data={}))
        self.assertHttpMethodNotAllowed(self.api_client.delete(stream_uri, format='json'))

    def test_get_list_all(self):
        data = self.get_list(
            'stream',
            offset=0,
            limit=0,
        )

        self.assertEqual(4, len(data['objects']))
        self.assertEqual(len(self.streams), len(data['objects']))

        for i, stream in enumerate(data['objects']):
            self.assertEqual(self.streams[i].id, stream.pop('id'))

            tags = stream.pop('tags')

            self.assertEqual('Stream %d' % tags['stream_number'], tags['title'])
            self.assertTrue('visualization' in tags, tags.get('visualization', None))
            self.assertTrue('description' in tags, tags.get('description', None))

            self.assertEqual(self.streams[i].tags, tags)

            if i < 3:
                self.assertItemsEqual(self.value_downsamplers, stream['value_downsamplers'])
            else:
                self.assertItemsEqual(['count'], stream['value_downsamplers'])
            self.assertItemsEqual(self.time_downsamplers, stream['time_downsamplers'])
            self.assertEqual('seconds', stream['highest_granularity'])

            self.assertEqual(self.streams[i].value_downsamplers, stream.pop('value_downsamplers'))
            self.assertEqual(self.streams[i].time_downsamplers, stream.pop('time_downsamplers'))
            self.assertEqual(self.streams[i].highest_granularity, stream.pop('highest_granularity'))

            # We manually construct URI to make sure it is like we assume it is.
            self.assertEqual('%s%s/' % (self.resource_list_uri('stream'), self.streams[i].id), stream.pop('resource_uri'))

            # It should be empty now, nothing else in. Especially not "datapoints".
            self.assertEqual({}, stream)

        self.assertMetaEqual({
            u'total_count': len(self.streams),
            # We specified 0 for limit in the request, so max limit should be used.
            u'limit': resources.StreamResource._meta.max_limit,
            u'offset': 0,
            u'next': None,
            u'previous': None,
        }, data['meta'])

    def test_get_list_offset(self):
        data = self.get_list(
            'stream',
            offset=1,
            limit=0,
        )

        streams = data['objects']
        self.assertEqual([stream.id for stream in self.streams[1:]], [stream['id'] for stream in streams])

        self.assertMetaEqual({
            u'total_count': len(self.streams),
            # We specified 0 for limit in the request, so max limit should be used.
            u'limit': resources.StreamResource._meta.max_limit,
            u'offset': 1,
            u'next': None,
            u'previous': u'%s?format=json&limit=1&offset=0' % self.resource_list_uri('stream'),
        }, data['meta'])

    def test_get_list_page(self):
        data = self.get_list(
            'stream',
            offset=1,
            limit=1,
        )

        streams = data['objects']
        self.assertEqual([stream.id for stream in self.streams[1:2]], [stream['id'] for stream in streams])

        self.assertMetaEqual({
            u'total_count': len(self.streams),
            u'limit': 1,
            u'offset': 1,
            u'next': u'%s?format=json&limit=1&offset=2' % self.resource_list_uri('stream'),
            u'previous': u'%s?format=json&limit=1&offset=0' % self.resource_list_uri('stream'),
        }, data['meta'])

    def test_get_list_last_page(self):
        data = self.get_list(
            'stream',
            offset=1,
            limit=100,
        )

        streams = data['objects']
        self.assertEqual([stream.id for stream in self.streams[1:]], [stream['id'] for stream in streams])

        self.assertMetaEqual({
            u'total_count': len(self.streams),
            u'limit': 100,
            u'offset': 1,
            u'next': None,
            u'previous': u'%s?format=json&limit=1&offset=0' % self.resource_list_uri('stream'),
        }, data['meta'])

    def test_tags_filter(self):
        for offset in (0, 1, 2):
            for limit in (0, 1, 20):
                for field_filter, filter_function in (
                    # We do not allow filtering by "stream_id". You should use detail API.
                    # (This s something which is allowed by datastream when using find_streams.)
                    ({'tags__stream_id': self.streams[0].id}, lambda stream: False),
                    # This is even more incorrect, it should be "stream_id", not "id".
                    ({'tags__id': self.streams[0].id}, lambda stream: False),
                    # Internal tags should not be exposed through the API.
                    ({'tags__value_type': 'numeric'}, lambda stream: False),
                    # Seconds, because this is class name in the database.
                    ({'tags__highest_granularity': 'Seconds'}, lambda stream: False),
                    ({'tags__title': 'Stream 1'}, lambda stream: stream.tags['title'] == 'Stream 1'),
                    ({'tags__title__iexact': 'stream 1'}, lambda stream: stream.tags['title'] == 'Stream 1'),
                    ({'tags__title__iexact': 'strEAm 1'}, lambda stream: stream.tags['title'] == 'Stream 1'),
                    ({'tags__title__icontains': 'strEAm'}, lambda stream: True), # All streams have this in the title.
                    ({'tags__stream_number': 1}, lambda stream: stream.tags['stream_number'] == 1),
                    ({'tags__stream_number__gte': 1}, lambda stream: stream.tags['stream_number'] >= 1),
                    ({'tags__stream_number__gt': 1}, lambda stream: stream.tags['stream_number'] > 1),
                    ({'tags__visualization__value_downsamplers': 'mean'}, lambda stream: 'mean' in stream.tags['visualization']['value_downsamplers']),
                    ({'tags__visualization__value_downsamplers__all': ['mean', 'min']}, lambda stream: 'mean' in stream.tags['visualization']['value_downsamplers'] and 'min' in stream.tags['visualization']['value_downsamplers']),
                    ({'tags__visualization__value_downsamplers__all': ['mean', 'foobar']}, lambda stream: False),
                    ({'tags__visualization__value_downsamplers__all': 'mean,min'}, lambda stream: 'mean' in stream.tags['visualization']['value_downsamplers'] and 'min' in stream.tags['visualization']['value_downsamplers']),
                    ({'tags__visualization__value_downsamplers__all': 'mean,foobar'}, lambda stream: False),
                    # Only filtering by tags works. No filtering is done.
                    ({'stream_id': self.streams[0].id}, lambda stream: True),
                    ({'id': self.streams[0].id}, lambda stream: True),
                    ({'highest_granularity': 'Seconds'}, lambda stream: True),
                    ({'highest_granularity': 'seconds'}, lambda stream: True),
                ):
                    kwargs = {
                        'offset': offset,
                        'limit': limit,
                    }
                    kwargs.update(field_filter)
                    data = self.get_list('stream', **kwargs)

                    filtered_streams = [stream.id for stream in filter(filter_function, self.streams)]
                    streams = data['objects']
                    self.assertEqual(filtered_streams[offset:offset + limit if limit else None], [stream['id'] for stream in streams], 'offset=%s, limit=%s, filter=%s' % (offset, limit, field_filter))

                    key = field_filter.keys()[0]
                    value = field_filter.values()[0]
                    if not isinstance(value, list):
                        value = [value]
                    value = [v if isinstance(v, basestring) else str(v) for v in value]
                    uri_filter = '&'.join(['%s=%s' % (key, urllib.quote(v)) for v in value])

                    limit = limit or resources.StreamResource._meta.max_limit

                    if 0 < offset < limit:
                        previous_limit = offset
                    else:
                        previous_limit = limit

                    self.assertMetaEqual({
                        u'total_count': len(filtered_streams),
                        u'limit': limit,
                        u'offset': offset,
                        u'next': u'%s?%s&format=json&limit=%s&offset=%s' % (self.resource_list_uri('stream'), uri_filter, limit, offset + limit) if limit and len(filtered_streams) > offset + limit else None,
                        u'previous': u'%s?%s&format=json&limit=%s&offset=%s' % (self.resource_list_uri('stream'), uri_filter, previous_limit, offset - previous_limit) if offset != 0 else None,
                    }, data['meta'])

    @unittest.skipUnless(apps, "Skipping for Django < 1.7")
    def test_schema(self):
        # We need Django 1.7+ for apps.
        with file(os.path.join(apps.get_app_config('test_app').path, 'tests', 'schema.json'), 'r') as f:
            schema = ujson.load(f)

        data = self.get_schema('stream')

        self.assertEqual(schema, data)

    def test_get_stream(self):
        stream = self.streams[0]
        serializer = serializers.DatastreamSerializer(datetime_formatting='rfc-2822')

        middle_time = calendar.timegm((stream.earliest_datapoint + (stream.latest_datapoint - stream.earliest_datapoint) / 2).utctimetuple())
        end_time = calendar.timegm(stream.latest_datapoint.utctimetuple())

        # There are 721 datapoints total.
        for offset in (0, 11, 56, 700):
            for limit in (0, 5, 40):
                for reverse in (True, False):
                    # We test start in test_get_downsampled.
                    for end in (None, middle_time, end_time):
                        for exclusive in (True, False):
                            kwargs = {
                                'offset': offset,
                                'limit': limit,
                            }
                            params = {}
                            if reverse:
                                params.update({'reverse': True})
                            if end and exclusive:
                                params.update({'end_exclusive': end})
                            elif end:
                                params.update({'end': end})
                            kwargs.update(params)

                            data = self.get_detail('stream', stream.id, **kwargs)

                            self.assertEqual(stream.id, data.pop('id'))
                            # We manually construct URI to make sure it is like we assume it is.
                            self.assertEqual(u'%s%s/' % (self.resource_list_uri('stream'), stream.id), data.pop('resource_uri'))
                            self.assertEqual(stream.tags, data.pop('tags'))
                            self.assertItemsEqual(self.value_downsamplers, data.pop('value_downsamplers'))
                            self.assertItemsEqual(self.time_downsamplers, data.pop('time_downsamplers'))
                            self.assertEqual(stream.highest_granularity, data.pop('highest_granularity'))

                            if end:
                                end_string = serializer.format_datetime(datetime.datetime.utcfromtimestamp(end))

                            self.assertEqual({
                                u'end': None if not end or exclusive else end_string,
                                u'reverse': reverse,
                                u'end_exclusive': end_string if end and exclusive else None,
                                u'start': u'Mon, 01 Jan 0001 00:00:00 -0000',
                                u'granularity': u'seconds',
                                u'time_downsamplers': None,
                                u'start_exclusive': None,
                                u'value_downsamplers': None,
                            }, data.pop('query_params'))

                            stream_datapoints = datastream.get_data(
                                stream_id=stream.id,
                                granularity=datastream.Granularity.Seconds,
                                start=datetime.datetime.min,
                                end=None if not end or exclusive else datetime.datetime.utcfromtimestamp(end),
                                start_exclusive=None,
                                end_exclusive=datetime.datetime.utcfromtimestamp(end) if end and exclusive else None,
                                reverse=reverse,
                                value_downsamplers=None,
                                time_downsamplers=None,
                            )
                            # We store the length before we maybe slice it in assertEqualDatapoints.
                            stream_datapoints_length = len(stream_datapoints)
                            self.assertEqualDatapoints(stream_datapoints, offset, limit, data.pop('datapoints'), 'offset=%s, limit=%s, reverse=%s, end=%s, exclusive=%s' % (offset, limit, reverse, end, exclusive))

                            if 0 < offset < limit:
                                previous_limit = offset
                            else:
                                previous_limit = limit

                            params = '&'.join(['%s=%s' % (k, urllib.quote(str(v))) for k, v in params.iteritems()])

                            self.assertMetaEqual({
                                u'total_count': stream_datapoints_length,
                                # For datapoints (details), limit should always be the same as we specified.
                                u'limit': limit,
                                u'offset': offset,
                                u'next': u'%s?%sformat=json&limit=%s&offset=%s' % (self.resource_detail_uri('stream', stream.id), '%s&' % params if params else '', limit, offset + limit) if limit and stream_datapoints_length > offset + limit else None,
                                u'previous': u'%s?%sformat=json&limit=%s&offset=%s' % (self.resource_detail_uri('stream', stream.id), '%s&' % params if params else '', previous_limit, offset - previous_limit) if limit and offset != 0 else None,
                            }, data.pop('meta'))

                            # We should check everything.
                            self.assertEqual({}, data)

    def test_get_downsampled(self):
        stream = self.streams[0]

        # First make sure everything is downsampled.
        until = (stream.latest_datapoint + datetime.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%S')

        prev = datastream.backend._time_offset
        datastream.backend._time_offset = datetime.timedelta(minutes=10)
        try:
            management.execute_from_command_line([sys.argv[0], 'downsample', '--until=%s' % until])
        finally:
            datastream.backend._time_offset = prev

        serializer = serializers.DatastreamSerializer(datetime_formatting='rfc-2822')

        middle_time = calendar.timegm((stream.earliest_datapoint + (stream.latest_datapoint - stream.earliest_datapoint) / 2).utctimetuple())
        start_time = calendar.timegm(stream.earliest_datapoint.utctimetuple())

        for granularity in ('10seconds', 'S'):
            # There are 360 datapoints total.
            for offset in (0, 11, 56, 331):
                for limit in (0, 5, 40):
                    for reverse in (True, False):
                        # We test end in test_get_stream.
                        for start in (None, start_time, middle_time):
                            for exclusive in (True, False):
                                for time_downsampler_query, time_downsampler in (
                                    (None, None),
                                    ('m', ['mean']),
                                    ('mean', ['mean']),
                                    ('a', ['first']),
                                    ('first', ['first']),
                                    ('a,z', ['first', 'last']),
                                    ('first,z', ['first', 'last']),
                                    ('first,last', ['first', 'last']),
                                    (['a', 'z'], ['first', 'last']),
                                    (['first', 'z'], ['first', 'last']),
                                    (['first', 'last'], ['first', 'last']),
                                ):
                                    for value_downsampler_query, value_downsampler in (
                                        (None, None),
                                        ('m', ['mean']),
                                        ('mean', ['mean']),
                                        ('l', ['min']),
                                        ('min', ['min']),
                                        ('l,u', ['min', 'max']),
                                        ('min,u', ['min', 'max']),
                                        ('min,max', ['min', 'max']),
                                        (['l', 'u'], ['min', 'max']),
                                        (['min', 'u'], ['min', 'max']),
                                        (['min', 'max'], ['min', 'max']),
                                    ):
                                        kwargs = {
                                            'offset': offset,
                                            'limit': limit,
                                        }
                                        params = {
                                            'granularity': granularity,
                                        }
                                        if reverse:
                                            params.update({'reverse': True})
                                        if start and exclusive:
                                            params.update({'start_exclusive': start})
                                        elif start:
                                            params.update({'start': start})
                                        if time_downsampler:
                                            params.update({'time_downsamplers': time_downsampler_query})
                                        if value_downsampler:
                                            params.update({'value_downsamplers': value_downsampler_query})
                                        kwargs.update(params)

                                        data = self.get_detail('stream', stream.id, **kwargs)

                                        self.assertEqual(stream.id, data.pop('id'))
                                        # We manually construct URI to make sure it is like we assume it is.
                                        self.assertEqual(u'%s%s/' % (self.resource_list_uri('stream'), stream.id), data.pop('resource_uri'))
                                        self.assertEqual(stream.tags, data.pop('tags'))
                                        self.assertItemsEqual(self.value_downsamplers, data.pop('value_downsamplers'))
                                        self.assertItemsEqual(self.time_downsamplers, data.pop('time_downsamplers'))
                                        self.assertEqual(stream.highest_granularity, data.pop('highest_granularity'))

                                        if start:
                                            start_string = serializer.format_datetime(datetime.datetime.utcfromtimestamp(start))

                                        self.assertEqual({
                                            u'end': None,
                                            u'reverse': reverse,
                                            u'end_exclusive': None,
                                            u'start': u'Mon, 01 Jan 0001 00:00:00 -0000' if not start else start_string if not exclusive else None,
                                            u'granularity': u'10seconds',
                                            u'time_downsamplers': time_downsampler,
                                            u'start_exclusive': start_string if start and exclusive else None,
                                            u'value_downsamplers': value_downsampler,
                                        }, data.pop('query_params'))

                                        stream_datapoints = datastream.get_data(
                                            stream_id=stream.id,
                                            granularity=datastream.Granularity.Seconds10,
                                            start=datetime.datetime.min if not start else datetime.datetime.utcfromtimestamp(start) if not exclusive else None,
                                            end=None,
                                            start_exclusive=datetime.datetime.utcfromtimestamp(start) if start and exclusive else None,
                                            end_exclusive=None,
                                            reverse=reverse,
                                            value_downsamplers=value_downsampler,
                                            time_downsamplers=time_downsampler,
                                        )
                                        # We store the length before we maybe slice it in assertEqualDatapoints.
                                        stream_datapoints_length = len(stream_datapoints)
                                        self.assertEqualDatapoints(stream_datapoints, offset, limit, data.pop('datapoints'), 'granularity=%s, offset=%s, limit=%s, reverse=%s, start=%s, exclusive=%s, time_downsampler=%s, value_downsampler=%s' % (granularity, offset, limit, reverse, start, exclusive, time_downsampler, value_downsampler))

                                        if 0 < offset < limit:
                                            previous_limit = offset
                                        else:
                                            previous_limit = limit

                                        params = '&'.join(['%s=%s' % (key, v) for key, value in params.iteritems() for v in (value if isinstance(value, list) else [value])])

                                        self.assertMetaEqual({
                                            u'total_count': stream_datapoints_length,
                                            # For datapoints (details), limit should always be the same as we specified.
                                            u'limit': limit,
                                            u'offset': offset,
                                            u'next': u'%s?%sformat=json&limit=%s&offset=%s' % (self.resource_detail_uri('stream', stream.id), '%s&' % params if params else '', limit, offset + limit) if limit and stream_datapoints_length > offset + limit else None,
                                            u'previous': u'%s?%sformat=json&limit=%s&offset=%s' % (self.resource_detail_uri('stream', stream.id), '%s&' % params if params else '', previous_limit, offset - previous_limit) if limit and offset != 0 else None,
                                        }, data.pop('meta'))

                                        # We should check everything.
                                        self.assertEqual({}, data)

                                        # This test takes long. We output ? regularly so that Travis CI does not timeout.
                                        sys.stdout.write('?')
                                        sys.stdout.flush()

    def test_ujson(self):
        # We are using a ujson fork which allows data to have a special __json__ method which
        # outputs raw JSON to be directly included in the output. This can speedup serialization
        # when data is already backed by JSON content.
        # See https://github.com/esnme/ultrajson/pull/157

        class JSONString(str):
            __slots__ = ()

            def __json__(self):
                return self

        data = {
            'first': {
                'foo': 'bar',
            },
            'second': [1, 2, 3],
        }

        data_with_json = {
            'first': JSONString(ujson.dumps(data['first'])),
            'second': JSONString(ujson.dumps(data['second'])),
        }

        self.assertEqual(data, ujson.loads(ujson.dumps(data)))
        self.assertEqual(data, ujson.loads(ujson.dumps(data_with_json)))

        serializer = serializers.DatastreamSerializer()

        self.assertEqual(data, serializer.from_json(serializer.to_json(data)))
        self.assertEqual(data, serializer.from_json(serializer.to_json(data_with_json)))

    def test_dates_serialization(self):
        # RFC 2822 dates might be generated wrong if non English locale is being active.
        # See https://github.com/toastdriven/django-tastypie/pull/656

        date = datetime.datetime(2014, 5, 5, 1, 5, 0, tzinfo=timezone.utc)

        serializer = serializers.DatastreamSerializer(datetime_formatting='rfc-2822')

        # We test also Tastypie serializer, to see if they fix it at some point.
        tastypie_serializer = tastypie_serializers.Serializer(datetime_formatting='rfc-2822')

        with translation.override('sl'):
            self.assertEqual('Mon, 05 May 2014 01:05:00 +0000', serializer.format_datetime(date))
            self.assertNotEqual('Mon, 05 May 2014 01:05:00 +0000', tastypie_serializer.format_datetime(date))

            self.assertEqual('05 May 2014', serializer.format_date(date))
            self.assertNotEqual('05 May 2014', tastypie_serializer.format_date(date))

            self.assertEqual('01:05:00 +0000', serializer.format_time(date))
            self.assertNotEqual('01:05:00 +0000', tastypie_serializer.format_time(date))
