import datetime
import os
import sys
import unittest
import urllib

from django.core import management
from django.utils import timezone, translation

import ujson

from tastypie import serializers as tastypie_serializers

from django_datastream import datastream, resources, serializers, test_runner

try:
    # Exists when Django >= 1.7.
    from django.apps import apps
except ImportError:
    apps = None


class BasicTest(test_runner.ResourceTestCase):
    @classmethod
    def setUpClass(cls):
        super(BasicTest, cls).setUpClass()

        cls.value_downsamplers = datastream.backend.value_downsamplers
        cls.time_downsamplers = datastream.backend.time_downsamplers

        # We first remove all streams.
        datastream.delete_streams()

        # And then create 3.
        management.execute_from_command_line([sys.argv[0], 'dummystream', '--types=int(0,10),float(-2,2),float(0,100)', '--span=1h', '--no-real-time'])

        cls.streams = [datastream.Stream(stream) for stream in datastream.find_streams()]

        for stream in cls.streams:
            # We have to convert these to unicode strings for tests to work.
            stream.highest_granularity = unicode(stream.highest_granularity)
            stream.value_downsamplers = [unicode(value_downsampler) for value_downsampler in stream.value_downsamplers]
            stream.time_downsamplers = [unicode(time_downsampler) for time_downsampler in stream.time_downsamplers]

    def test_api_uris(self):
        # URIs have to be stable.

        self.assertEqual('/api/v1/stream/', self.resource_list_uri('stream'))
        self.assertEqual('/api/v1/stream/schema/', self.resource_schema_uri('stream'))

    def test_get_list_all(self):
        data = self.get_list(
            'stream',
            offset=0,
            limit=0,
        )

        self.assertEqual(3, len(data['objects']))
        self.assertEqual(len(self.streams), len(data['objects']))

        for i, stream in enumerate(data['objects']):
            self.assertEqual(self.streams[i].id, stream.pop('id'))

            tags = stream.pop('tags')

            self.assertEqual('Stream %d' % tags['stream_number'], tags['title'])
            self.assertTrue('visualization' in tags, tags.get('visualization', None))
            self.assertTrue('description' in tags, tags.get('description', None))

            self.assertEqual(self.streams[i].tags, tags)

            self.assertItemsEqual(self.value_downsamplers, stream['value_downsamplers'])
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
            u'total_count': 3,
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
            u'total_count': 3,
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
            u'total_count': 3,
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
            u'total_count': 3,
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

            u'end': None,
            u'reverse': False,
            u'end_exclusive': None,
            u'start': u'Mon, 01 Jan 0001 00:00:00 -0000',
            u'granularity': u'seconds',
            u'time_downsamplers': None,
            u'start_exclusive': None,
            u'value_downsamplers': None,
        })

        self.assertEqual(response['meta']['previous'], None)
        self.assertEqual(response['meta']['offset'], 0)
        self.assertEqual(response['meta']['limit'], 100)
        self.assertTrue(response['meta']['total_count'] > 100)

        self.assertEqual(len(response['datapoints']), 100)

        self.assertTrue('t' in response['datapoints'][0])
        self.assertTrue('v' in response['datapoints'][0])

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
