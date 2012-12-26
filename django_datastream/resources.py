from __future__ import absolute_import

import datetime, urllib

import pytz

from tastypie import bundle, exceptions, fields, http, paginator, resources

from . import datastream, serializers
from datastream import exceptions as datastream_exceptions

class InvalidGranularity(exceptions.BadRequest):
    pass

class InvalidDownsampler(exceptions.BadRequest):
    pass

class InvalidRange(exceptions.BadRequest):
    pass

QUERY_GRANULARITY = 'g'
QUERY_START = 's'
QUERY_END = 'e'
QUERY_START_EXCLUSIVE = 'sx'
QUERY_END_EXCLUSIVE = 'ex'
QUERY_VALUE_DOWNSAMPLERS = 'v'
QUERY_TIME_DOWNSAMPLERS = 't'
QUERY_REVERSE = 'r'

class DatapointsField(fields.ApiField):
    """
    A datapoints field.
    """

    dehydrated_type = 'datapoints'
    help_text = "A list of datapoints."

class Paginator(paginator.Paginator):
    def get_slice(self, limit, offset):
        if limit == 0:
            # If zero, return nothing
            return []

        # Optimization
        self.objects.batch_size(limit)

        return list(self.objects[offset:offset + limit])

    def _generate_uri(self, limit, offset):
        if self.resource_uri is None:
            return None

        request_params = dict([k, v.encode('utf-8')] for k, v in self.request_data.items())

        if 'offset' in request_params:
            del request_params['offset']
        if 'limit' in request_params:
            del request_params['limit']

        request_params.update({'l': limit, 'o': offset})

        return '%s?%s' % (
            self.resource_uri,
            urllib.urlencode(request_params)
        )

    def get_limit(self):
        if 'l' not in self.request_data:
            return super(Paginator, self).get_limit()

        limit = self.request_data['l']

        try:
            limit = int(self.request_data['l'])
        except ValueError:
            raise exceptions.BadRequest("Invalid limit '%s' provided. Please provide a positive integer.", limit)

        if limit < 0:
            raise exceptions.BadRequest("Invalid limit '%s' provided. Please provide an integer >= 0.", limit)

        return limit

    def get_offset(self):
        if 'o' not in self.request_data:
            return super(Paginator, self).get_offset()

        offset = self.request_data['o']

        try:
            offset = int(offset)
        except ValueError:
            raise exceptions.BadRequest("Invalid offset '%s' provided. Please provide an integer.", offset)

        if offset < 0:
            raise exceptions.BadRequest("Invalid offset '%s' provided. Please provide an integer >= 0.", offset)

        return offset

class StreamResource(resources.Resource):
    class Meta:
        list_allowed_methods = ('get',)
        detail_allowed_methods = ('get', 'wait')
        only_detail_fields = ('datapoints',)
        serializer = serializers.DatastreamSerializer()
        paginator_class = Paginator
        limit = 100

    # TODO: Set help text
    id = fields.CharField(attribute='id', null=False, blank=False, readonly=True, unique=True, help_text=None)
    value_downsamplers = fields.ListField(attribute='value_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    time_downsamplers = fields.ListField(attribute='time_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    highest_granularity = fields.CharField(attribute='highest_granularity', null=False, blank=False, readonly=True, help_text=None)
    tags = fields.ListField(attribute='tags', null=True, blank=False, readonly=False, help_text=None)

    datapoints = DatapointsField(attribute='datapoints', null=True, blank=False, readonly=True, help_text=None)

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
        # TODO: Provide users a way to query streams by tags
        return [datastream.Stream(stream) for stream in datastream.find_streams()]

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
        data.data['query_params'] = self._get_query_params(request, data.obj)

        paginator = self._meta.paginator_class(request.GET, data.data['datapoints'], resource_uri=data.data['resource_uri'], limit=self._meta.limit)
        page = paginator.page()

        data.data['datapoints'] = page['objects']
        data.data.setdefault('meta', {}).update(page['meta'])

        return data

    def _get_query_params(self, request, stream):
        granularity = request.GET.get(QUERY_GRANULARITY, None)
        for g in datastream.Granularity.values:
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

        reverse = request.GET.get(QUERY_REVERSE, '0').lower() in ('yes', 'true', 't', '1', 'y')

        value_downsamplers = []
        for downsampler in request.GET.getlist(QUERY_VALUE_DOWNSAMPLERS, []):
            for d in downsampler.split(','):
                for name, key in datastream.VALUE_DOWNSAMPLERS.items():
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

    def obj_get(self, request=None, **kwargs):
        try:
            stream = datastream.Stream(datastream.get_tags(kwargs['pk']))
        except datastream_exceptions.StreamNotFound:
            raise exceptions.NotFound("Stream '%s' not found." % kwargs['pk'])

        params = self._get_query_params(request, stream)

        if not params['start'] and not params['start_exclusive']:
            params['start'] = datetime.datetime.min

        stream.datapoints = datastream.get_data(
            stream_id=kwargs['pk'],
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

    def wait_detail(self, request, **kwargs):
        # TODO: Implement
        return http.HttpNotImplemented()
