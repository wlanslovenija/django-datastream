import urlparse

from django.core import urlresolvers
from django.test import simple

from tastypie import test

from django_datastream import datastream


class DatastreamSuiteRunner(simple.DjangoTestSuiteRunner):
    """
    It is the same as in DjangoTestSuiteRunner, but without relational databases.
    """

    def setup_databases(self, **kwargs):
        datastream._switch_database('django_datastream_testing')

    def teardown_databases(self, old_config, **kwargs):
        datastream.delete_streams()


class ResourceTestCase(test.ResourceTestCase):
    api_name = 'v1'
    namespace = None
    # To always display full diff.
    maxDiff = None

    @classmethod
    def resource_list_uri(cls, resource_name):
        namespace_prefix = '%s:' % cls.namespace if cls.namespace else ''
        return urlresolvers.reverse('%sapi_dispatch_list' % namespace_prefix, kwargs={'api_name': cls.api_name, 'resource_name': resource_name})

    @classmethod
    def resource_schema_uri(cls, resource_name):
        namespace_prefix = '%s:' % cls.namespace if cls.namespace else ''
        return urlresolvers.reverse('%sapi_get_schema' % namespace_prefix, kwargs={'api_name': cls.api_name, 'resource_name': resource_name})

    @classmethod
    def resource_detail_uri(cls, resource_name, pk):
        namespace_prefix = '%s:' % cls.namespace if cls.namespace else ''
        return urlresolvers.reverse('%sapi_dispatch_detail' % namespace_prefix, kwargs={'api_name': cls.api_name, 'resource_name': resource_name, 'pk': pk})

    def get_list(self, resource_name, **kwargs):
        return self.get_uri(self.resource_list_uri(resource_name), **kwargs)

    def get_schema(self, resource_name, **kwargs):
        return self.get_uri(self.resource_schema_uri(resource_name), **kwargs)

    def get_detail(self, resource_name, pk, **kwargs):
        return self.get_uri(self.resource_detail_uri(resource_name, pk), **kwargs)

    def get_uri(self, uri, **kwargs):
        kwargs['format'] = 'json'

        response = self.api_client.get(uri, data=kwargs)

        self.assertValidJSONResponse(response)

        return self.deserialize(response)

    def assertMetaEqual(self, meta1, meta2):
        meta1next = meta1.pop('next')
        meta2next = meta2.pop('next')
        meta1previous = meta1.pop('previous')
        meta2previous = meta2.pop('previous')

        meta1next_query = None
        meta2next_query = None
        meta1previous_query = None
        meta2previous_query = None

        self.assertEqual(meta1, meta2)

        if meta1next is not None:
            meta1next = urlparse.urlparse(meta1next)
            meta1next_query = urlparse.parse_qs(meta1next.query, strict_parsing=True)
        if meta2next is not None:
            meta2next = urlparse.urlparse(meta2next)
            meta2next_query = urlparse.parse_qs(meta2next.query, strict_parsing=True)
        if meta1previous is not None:
            meta1previous = urlparse.urlparse(meta1previous)
            meta1previous_query = urlparse.parse_qs(meta1previous.query, strict_parsing=True)
        if meta2previous is not None:
            meta2previous = urlparse.urlparse(meta2previous)
            meta2previous_query = urlparse.parse_qs(meta2previous.query, strict_parsing=True)

        self.assertEqual(getattr(meta1next, 'path', None), getattr(meta2next, 'path', None))
        self.assertEqual(getattr(meta1previous, 'path', None), getattr(meta2previous, 'path', None))

        self.assertEqual(meta1next_query, meta2next_query)
        self.assertEqual(meta1previous_query, meta2previous_query)
