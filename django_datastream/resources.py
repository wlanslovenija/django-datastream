from __future__ import absolute_import

import datetime

import pytz

from django.conf import settings

from tastypie import bundle as tastypie_bundle, exceptions, fields as tastypie_fields, resources

from . import datastream, fields, paginator, serializers
from datastream import api as datastream_api, exceptions as datastream_exceptions


class InvalidGranularity(exceptions.BadRequest):
    pass


class InvalidDownsampler(exceptions.BadRequest):
    pass


class InvalidRange(exceptions.BadRequest):
    pass


QUERY_GRANULARITY = 'granularity'
QUERY_START = 'start'
QUERY_END = 'end'
QUERY_START_EXCLUSIVE = 'start_exclusive'
QUERY_END_EXCLUSIVE = 'end_exclusive'
QUERY_VALUE_DOWNSAMPLERS = 'value_downsamplers'
QUERY_TIME_DOWNSAMPLERS = 'time_downsamplers'
QUERY_REVERSE = 'reverse'


class StreamsList(datastream_api.ResultsBase):
    def __init__(self, cursor):
        self.cursor = cursor

    def batch_size(self, batch_size):
        self.cursor.batch_size(batch_size)

    def count(self):
        return self.cursor.count()

    def __iter__(self):
        for stream in self.cursor:
            yield datastream.Stream(stream)

    def __getitem__(self, key):
        if isinstance(key, slice):
            return StreamsList(self.cursor.__getitem__(key))
        elif isinstance(key, (int, long)):
            return datastream.Stream(self.cursor.__getitem__(key))
        else:
            raise TypeError


class StreamResource(resources.Resource):
    class Meta:
        list_allowed_methods = ('get',)
        detail_allowed_methods = ('get',)
        only_detail_fields = ('datapoints',)
        serializer = serializers.DatastreamSerializer()
        paginator_class = paginator.Paginator
        detail_paginator_class = paginator.DetailPaginator
        detail_limit = getattr(settings, 'API_DETAIL_LIMIT_PER_PAGE', 100)
        max_detail_limit = 10000

    # TODO: Set help text
    id = tastypie_fields.CharField(attribute='id', null=False, blank=False, readonly=True, unique=True, help_text=None)
    value_downsamplers = tastypie_fields.ListField(attribute='value_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    time_downsamplers = tastypie_fields.ListField(attribute='time_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    highest_granularity = tastypie_fields.CharField(attribute='highest_granularity', null=False, blank=False, readonly=True, help_text=None)
    tags = tastypie_fields.DictField(attribute='tags', null=True, blank=False, readonly=False, help_text=None)

    datapoints = fields.DatapointsField(attribute='datapoints', null=True, blank=False, readonly=True, help_text=None)

    def detail_uri_kwargs(self, bundle_or_obj):
        kwargs = {}

        if isinstance(bundle_or_obj, tastypie_bundle.Bundle):
            kwargs[self._meta.detail_uri_name] = bundle_or_obj.obj.id
        else:
            kwargs[self._meta.detail_uri_name] = bundle_or_obj.id

        return kwargs

    def get_object_list(self, request):
        # TODO: Provide users a way to query streams by tags (is this the same as allow filtering?) (use ListQuerySet from django-tastypie-mongoengine?)
        return StreamsList(datastream.find_streams())

    def apply_sorting(self, obj_list, options=None):
        # TODO: Allow sorting (use ListQuerySet from django-tastypie-mongoengine?)
        return obj_list

    def obj_get_list(self, bundle, **kwargs):
        return self.get_object_list(bundle.request)

    def alter_list_data_to_serialize(self, request, data):
        data = super(StreamResource, self).alter_list_data_to_serialize(request, data)
        for obj in data['objects']:
            for field_name in self._meta.only_detail_fields:
                del obj.data[field_name]
        return data

    def alter_detail_data_to_serialize(self, request, data):
        data.data['query_params'] = self._get_query_params(request, data.obj)

        paginator = self._meta.detail_paginator_class(request.GET, data.data['datapoints'], resource_uri=data.data['resource_uri'], limit=self._meta.detail_limit, max_limit=self._meta.max_detail_limit, collection_name='datapoints')
        page = paginator.page()

        data.data['datapoints'] = list(page['datapoints'])
        data.data.setdefault('meta', {}).update(page['meta'])

        return data

    def _get_query_params(self, request, stream):
        granularity = request.GET.get(QUERY_GRANULARITY, None)
        for g in datastream.Granularity.values:
            if granularity == g.name:
                granularity = g
                break
            if granularity == g.key:
                granularity = g
                break
        else:
            if granularity is None:
                granularity = stream.highest_granularity
            else:
                raise InvalidGranularity("Invalid granularity: '%s'" % granularity)

        if QUERY_START in request.GET:
            start = datetime.datetime.fromtimestamp(int(request.GET.get(QUERY_START)), pytz.utc)
        else:
            start = None

        if QUERY_END in request.GET:
            end = datetime.datetime.fromtimestamp(int(request.GET.get(QUERY_END)), pytz.utc)
        else:
            end = None

        if QUERY_START_EXCLUSIVE in request.GET:
            start_exclusive = datetime.datetime.fromtimestamp(int(request.GET.get(QUERY_START_EXCLUSIVE)), pytz.utc)
        else:
            start_exclusive = None

        if QUERY_END_EXCLUSIVE in request.GET:
            end_exclusive = datetime.datetime.fromtimestamp(int(request.GET.get(QUERY_END_EXCLUSIVE)), pytz.utc)
        else:
            end_exclusive = None

        if start and start_exclusive:
            raise InvalidRange("Only one time range start can be specified.")

        if end and end_exclusive:
            raise InvalidRange("Only one time range end can be specified.")

        if not start and not start_exclusive:
            start = datetime.datetime.min

        reverse = request.GET.get(QUERY_REVERSE, '0').lower() in ('yes', 'true', 't', '1', 'y')

        value_downsamplers = []
        for downsampler in request.GET.getlist(QUERY_VALUE_DOWNSAMPLERS, []):
            for d in downsampler.split(','):
                for name, key in datastream.VALUE_DOWNSAMPLERS.items():
                    if d == name:
                        value_downsamplers.append(name)
                        break
                    if d == key:
                        value_downsamplers.append(name)
                        break
                else:
                    raise InvalidDownsampler("Invalid value downsampler: '%s'" % downsampler)

        if value_downsamplers == []:
            value_downsamplers = None

        time_downsamplers = []
        for downsampler in request.GET.getlist(QUERY_TIME_DOWNSAMPLERS, []):
            for d in downsampler.split(','):
                for name, key in datastream.TIME_DOWNSAMPLERS.items():
                    if d == name:
                        time_downsamplers.append(name)
                        break
                    if d == key:
                        time_downsamplers.append(name)
                        break
                else:
                    raise InvalidDownsampler("Invalid time downsampler: '%s'" % downsampler)

        if time_downsamplers == []:
            time_downsamplers = None

        return {
            'granularity': granularity,
            'start': start,
            'end': end,
            'start_exclusive': start_exclusive,
            'end_exclusive': end_exclusive,
            'reverse': reverse,
            'value_downsamplers': value_downsamplers,
            'time_downsamplers': time_downsamplers,
        }

    def obj_get(self, bundle, **kwargs):
        try:
            stream = datastream.Stream(datastream.get_tags(kwargs['pk']))
        except datastream_exceptions.StreamNotFound:
            raise exceptions.NotFound("Stream '%s' not found." % kwargs['pk'])

        params = self._get_query_params(bundle.request, stream)

        stream.datapoints = datastream.get_data(
            stream_id=stream.id,
            granularity=params['granularity'],
            start=params['start'],
            end=params['end'],
            start_exclusive=params['start_exclusive'],
            end_exclusive=params['end_exclusive'],
            reverse=params['reverse'],
            value_downsamplers=params['value_downsamplers'],
            time_downsamplers=params['time_downsamplers'],
        )

        return stream

    def obj_create(self, bundle, **kwargs):
        raise NotImplementedError

    def obj_update(self, bundle, **kwargs):
        raise NotImplementedError

    def obj_delete_list(self, bundle, **kwargs):
        raise NotImplementedError

    def obj_delete(self, bundle, **kwargs):
        raise NotImplementedError

    def rollback(self, bundles):
        raise NotImplementedError
