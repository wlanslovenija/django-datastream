import sys

from django import test
from django.core import management, urlresolvers
from django.test import client
from django.utils import simplejson as json

from django_datastream import datastream


class BasicTest(test.TestCase):
    api_name = 'v1'
    c = client.Client()
    value_downsamplers = datastream.backend.value_downsamplers
    time_downsamplers = datastream.backend.time_downsamplers

    def resourceListURI(self, resource_name):
        return urlresolvers.reverse('api_dispatch_list', kwargs={'api_name': self.api_name, 'resource_name': resource_name})

    def test_basic(self):
        response = self.c.get(self.resourceListURI('stream'))
        self.assertEqual(response.status_code, 200)
        response = json.loads(response.content)

        self.assertEqual(response['objects'], [])

        management.execute_from_command_line([sys.argv[0], 'dummystream', '--types=int(0,10),float(-2,2),float(0,100)', '--span=1h', '--no-real-time'])

        response = self.c.get(self.resourceListURI('stream'))
        self.assertEqual(response.status_code, 200)
        response = json.loads(response.content)

        self.assertEqual(response['meta']['total_count'], 3)

        for i, stream in enumerate(response['objects']):
            tags = stream['tags']

            self.assertEqual(tags['title'], 'Stream %d' % tags['stream_number'], tags['title'])
            self.assertTrue('visualization' in tags, tags.get('visualization', None))
            self.assertTrue('description' in tags, tags.get('description', None))

            self.assertItemsEqual(stream['value_downsamplers'], self.value_downsamplers)
            self.assertItemsEqual(stream['time_downsamplers'], self.time_downsamplers)
            self.assertEqual(stream['highest_granularity'], 'seconds')

        stream = response['objects'][-1]

        stream_uri = stream['resource_uri']

        response = self.c.get(stream_uri)
        self.assertEqual(response.status_code, 200)
        response = json.loads(response.content)

        self.assertEqual(response['id'], stream['id'])
        self.assertEqual(response['resource_uri'], stream_uri)
        self.assertEqual(response['tags'], tags)
        self.assertItemsEqual(response['value_downsamplers'], self.value_downsamplers)
        self.assertItemsEqual(response['time_downsamplers'], self.time_downsamplers)
        self.assertEqual(response['highest_granularity'], 'seconds')

        self.assertEqual(response['query_params'], {
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
