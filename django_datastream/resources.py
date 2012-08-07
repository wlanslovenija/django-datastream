from __future__ import absolute_import

import datetime

from django.conf import urls
from django.core import urlresolvers

from tastypie import bundle, exceptions, fields, resources, utils

from . import datastream

class InvalidGranularity(exceptions.BadRequest):
    pass

class InvalidDownsampler(exceptions.BadRequest):
    pass

QUERY_GRANULARITY = 'g'
QUERY_START = 's'
QUERY_END = 'e'
QUERY_DOWNSAMPLERS = 'd'

class MetricResource(resources.Resource):
    class Meta:
        allowed_methods = ('get',)
        only_detail_fields = ('datapoints',)

    # TODO: Set help text
    id = fields.CharField(attribute='id', null=False, blank=False, readonly=True, unique=True, help_text=None)
    downsamplers = fields.ListField(attribute='downsamplers', null=False, blank=False, readonly=True, help_text=None)
    highest_granularity = fields.CharField(attribute='highest_granularity', null=False, blank=False, readonly=True, help_text=None)
    tags = fields.ListField(attribute='tags', null=True, blank=False, readonly=False, help_text=None)

    datapoints = fields.ListField('datapoints', null=True, blank=False, readonly=True, help_text=None)

    datastream_uri = fields.CharField(null=False, blank=False, readonly=True, help_text=None)

    def get_resource_uri(self, bundle_or_obj):
        kwargs = {
            'resource_name': self._meta.resource_name,
        }

        if isinstance(bundle_or_obj, bundle.Bundle):
            kwargs['pk'] = bundle_or_obj.obj.id
        else:
            kwargs['pk'] = bundle_or_obj.id

        if self._meta.api_name is not None:
            kwargs['api_name'] = self._meta.api_name

        return self._build_reverse_url('api_dispatch_detail', kwargs=kwargs)

    def get_object_list(self, request):
        # TODO: Provide users a way to query metrics by tags
        return [datastream.Metric(metric) for metric in datastream.find_metrics()]

    def apply_sorting(self, obj_list, options=None):
        return obj_list

    def obj_get_list(self, request=None, **kwargs):
        return self.get_object_list(request)

    def alter_list_data_to_serialize(self, request, data):
        for obj in data['objects']:
            for field_name in self._meta.only_detail_fields:
                del obj.data[field_name]
        return data

    def alter_detail_data_to_serialize(self, request, data):
        data.data['_query_params'] = self._get_query_params(request)
        return data

    def _get_query_params(self, request):
        granularity = request.GET.get(QUERY_GRANULARITY, datastream.Granularity.values[-1].name.lower()[0])
        for g in datastream.Granularity.values:
            if granularity == g.name.lower()[0]:
                granularity = g
                break
        else:
            raise InvalidGranularity("Invalid granularity: '%s'" % granularity)

        start = datetime.datetime.utcfromtimestamp(request.GET.get(QUERY_START, 0))
        if QUERY_END in request.GET:
            end = datetime.datetime.utcfromtimestamp(request.GET.get(QUERY_END))
        else:
            end = None

        downsamplers = []
        for downsampler in request.GET.getlist(QUERY_DOWNSAMPLERS, []):
            for d in downsampler.split(','):
                for name, key in datastream.DOWNSAMPLERS.items():
                    if d == key:
                        downsamplers.append(name)
                        break
                else:
                    raise InvalidDownsampler("Invalid downsampler: '%s'" % downsampler)

        if downsamplers == []:
            downsamplers = None

        return {
            'granularity': granularity,
            'start': start,
            'end': end,
            'downsamplers': downsamplers,
        }

    def obj_get(self, request=None, **kwargs):
        # TODO: Handle 404
        metric = datastream.Metric(datastream.get_tags(kwargs['pk']))

        params = self._get_query_params(request)

        metric.datapoints = datastream.get_data(kwargs['pk'], params['granularity'], params['start'], params['end'], params['downsamplers'])

        return metric

    def dehydrate_datastream_uri(self, bundle):
        kwargs = {
            'pk': bundle.obj.id,
        }

        if self._meta.api_name is not None:
            kwargs['api_name'] = self._meta.api_name

        return urlresolvers.reverse('datastream', kwargs=kwargs)

    def override_urls(self):
        return [
            urls.url(r"^%s/(?P<pk>\w[\w/-]*)/datastream%s$" % (self._meta.resource_name, utils.trailing_slash()), self.wrap_view('datastream_view'), name="datastream"),
        ]

    def datastream_view(self, request, api_name, pk):
        granularity = self._get_query_params(request)['granularity']

        # TODO: Return redirect to channel

    def obj_create(self, bundle, request=None, **kwargs):
        raise NotImplementedError

    def obj_update(self, bundle, request=None, **kwargs):
        raise NotImplementedError

    def obj_delete_list(self, request=None, **kwargs):
        raise NotImplementedError

    def obj_delete(self, request=None, **kwargs):
        raise NotImplementedError

    def rollback(self, bundles):
        raise NotImplementedError
