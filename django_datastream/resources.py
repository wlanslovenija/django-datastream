from __future__ import absolute_import

import datetime

from tastypie import bundle, fields, resources

from datastream import GRANULARITIES

from . import datastream

class Metric(object):
    downsamplers = None
    granularity = None
    datapoints = None

    def __init__(self, metric):
        tags = []
        for tag in metric:
            try:
                self.id = tag['metric_id']
                continue
            except (ValueError, KeyError, TypeError):
                pass

            try:
                self.available_downsamplers = tag['downsamplers']
                continue
            except (ValueError, KeyError, TypeError):
                pass

            try:
                self.highest_granularity = tag['highest_granularity']
                continue
            except (ValueError, KeyError, TypeError):
                pass

            tags.append(tag)

        self.tags = tags

class MetricResource(resources.Resource):
    class Meta:
        allowed_methods = ('get',)
        only_detail_fields = ('downsamplers', 'granularity', 'datapoints')

    id = fields.CharField(attribute='id', null=False, blank=False, readonly=True, unique=True, help_text=None)
    available_downsamplers = fields.ListField(attribute='available_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    highest_granularity = fields.CharField(attribute='highest_granularity', null=False, blank=False, readonly=True, help_text=None)
    tags = fields.ListField(attribute='tags', null=True, blank=False, readonly=False, help_text=None)

    downsamplers = fields.ListField('downsamplers', null=True, blank=False, readonly=True, help_text=None)
    granularity = fields.CharField('granularity', null=True, blank=False, readonly=True, help_text=None)
    datapoints = fields.ListField('datapoints', null=True, blank=False, readonly=True, help_text=None)

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
        return [Metric(metric) for metric in datastream.find_metrics()]

    def apply_filters(self, request, applicable_filters):
        pass

    def obj_get_list(self, request=None, **kwargs):
        return self.get_object_list(request)

    def alter_list_data_to_serialize(self, request, data):
        for obj in data['objects']:
            for field_name in self._meta.only_detail_fields:
                del obj.data[field_name]
        return data

    def obj_get(self, request=None, **kwargs):
        metric = Metric(datastream.get_tags(kwargs['pk']))

        # TODO: Make downsamplers and granularity and start and end configurable
        metric.downsamplers = metric.available_downsamplers
        metric.granularity = GRANULARITIES[0]
        metric.datapoints = datastream.get_data(kwargs['pk'], metric.granularity, datetime.datetime.fromtimestamp(0), datetime.datetime.now())

        return metric

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
