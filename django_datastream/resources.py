import datetime

from django import http
from django.conf import settings

from tastypie import bundle as tastypie_bundle, exceptions, fields as tastypie_fields, http as tastypie_http, resources

from . import datastream, fields, paginator as datastream_paginator, serializers
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
QUERY_TAGS = 'tags'


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


class BaseResource(resources.Resource):
    @staticmethod
    def value_to_list(params, field):
        if hasattr(params, 'getlist'):
            value = []

            for part in params.getlist(field):
                value.extend(part.split(','))
        else:
            value = params.get(field, '').split(',')

        return value

    def basic_filter_value_to_python(self, value):
        if value in ['true', 'True', True]:
            return True
        elif value in ['false', 'False', False]:
            return False
        elif value in ('none', 'None', 'null', None):
            return None
        else:
            return value

    def get_list(self, request, **kwargs):
        response = super(BaseResource, self).get_list(request, **kwargs)
        return self.add_cors_headers(response)

    def get_detail(self, request, **kwargs):
        response = super(BaseResource, self).get_detail(request, **kwargs)
        return self.add_cors_headers(response)

    def get_schema(self, request, **kwargs):
        response = super(BaseResource, self).get_schema(request, **kwargs)
        return self.add_cors_headers(response)

    def get_multiple(self, request, **kwargs):
        response = super(BaseResource, self).get_multiple(request, **kwargs)
        return self.add_cors_headers(response)

    def error_response(self, request, errors, response_class=None):
        response = super(BaseResource, self).error_response(request, errors, response_class)
        return self.add_cors_headers(response)

    # Copy of parent method_check, with call to add_cors_headers.
    def method_check(self, request, allowed=None):
        if allowed is None:
            allowed = []

        request_method = request.method.lower()
        allows = ','.join([meth.upper() for meth in allowed])

        if request_method == "options":
            response = http.HttpResponse(allows)
            response['Allow'] = allows
            self.add_cors_headers(response)
            raise exceptions.ImmediateHttpResponse(response=response)

        if request_method not in allowed:
            response = tastypie_http.HttpMethodNotAllowed(allows)
            response['Allow'] = allows
            raise exceptions.ImmediateHttpResponse(response=response)

        return request_method

    def add_cors_headers(self, response):
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Headers'] = 'Content-Type'
        response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        response['Access-Control-Max-Age'] = 60 * 60 # seconds, 1 hour
        return response


class StreamResource(BaseResource):
    class Meta:
        resource_name = 'stream'
        list_allowed_methods = ('get',)
        detail_allowed_methods = ('get',)
        serializer = serializers.DatastreamSerializer()
        paginator_class = datastream_paginator.BatchSizePaginator
        detail_paginator_class = datastream_paginator.DetailPaginator
        detail_limit = getattr(settings, 'API_DETAIL_LIMIT_PER_PAGE', 100)
        max_detail_limit = 10000

    # TODO: Set help text (improve field types/descriptions in the schema)
    id = tastypie_fields.CharField(attribute='id', null=False, blank=False, readonly=True, unique=True, help_text=None)
    value_downsamplers = tastypie_fields.ListField(attribute='value_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    time_downsamplers = tastypie_fields.ListField(attribute='time_downsamplers', null=False, blank=False, readonly=True, help_text=None)
    highest_granularity = tastypie_fields.CharField(attribute='highest_granularity', null=False, blank=False, readonly=True, help_text=None)
    tags = tastypie_fields.DictField(attribute='tags', null=True, blank=False, readonly=False, help_text=None)
    earliest_datapoint = tastypie_fields.DateTimeField(attribute='earliest_datapoint', null=True, blank=False, readonly=True, help_text=None)
    latest_datapoint = tastypie_fields.DateTimeField(attribute='latest_datapoint', null=True, blank=False, readonly=True, help_text=None)
    value_type = tastypie_fields.CharField(attribute='value_type', null=False, blank=False, default='numeric', readonly=True, unique=True, help_text=None)

    # We show datapoints only in detail view. And we allow pagination over them.
    datapoints = fields.DatapointsField(attribute='datapoints', null=True, blank=False, readonly=True, help_text=None, use_in='detail')

    def detail_uri_kwargs(self, bundle_or_obj):
        kwargs = {}

        if isinstance(bundle_or_obj, tastypie_bundle.Bundle):
            kwargs[self._meta.detail_uri_name] = bundle_or_obj.obj.id
        else:
            kwargs[self._meta.detail_uri_name] = bundle_or_obj.id

        return kwargs

    def get_object_list(self, request):
        query_tags = {}

        filters = request.GET.copy()
        for filter_expr, value in filters.iteritems():
            filter_bits = filter_expr.split('__')
            field_name = filter_bits.pop(0)

            if field_name != 'tags':
                # We allow filtering only over tags.
                continue

            value = self.filter_value_to_python(value, filter_bits[-1], filters, filter_expr)

            parent_tag = query_tags
            for tag in filter_bits[:-1]:
                parent_tag = parent_tag.setdefault(tag, {})
            parent_tag[filter_bits[-1]] = value

        return StreamsList(datastream.find_streams(query_tags))

    def apply_sorting(self, obj_list, options=None):
        # TODO: Allow sorting (use ListQuerySet from django-tastypie-mongoengine? or provide API for that in datastream)
        return obj_list

    def obj_get_list(self, bundle, **kwargs):
        return self.get_object_list(bundle.request)

    def alter_detail_data_to_serialize(self, request, data):
        data.data['query_params'] = self._get_query_params(request, data.obj)

        paginator = self._meta.detail_paginator_class(request.GET, data.data['datapoints'], resource_uri=data.data['resource_uri'], limit=self._meta.detail_limit, max_limit=self._meta.max_detail_limit, collection_name='datapoints')
        page = paginator.page()

        data.data['datapoints'] = page['datapoints']
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
            try:
                start = datetime.datetime.utcfromtimestamp(int(request.GET.get(QUERY_START)))
            except ValueError:
                raise InvalidRange("Invalid time range start value: '%s'" % request.GET.get(QUERY_START))
        else:
            start = None

        if QUERY_END in request.GET:
            try:
                end = datetime.datetime.utcfromtimestamp(int(request.GET.get(QUERY_END)))
            except ValueError:
                raise InvalidRange("Invalid time range end value: '%s'" % request.GET.get(QUERY_END))
        else:
            end = None

        if QUERY_START_EXCLUSIVE in request.GET:
            try:
                start_exclusive = datetime.datetime.utcfromtimestamp(int(request.GET.get(QUERY_START_EXCLUSIVE)))
            except ValueError:
                raise InvalidRange("Invalid time range start value: '%s'" % request.GET.get(QUERY_START_EXCLUSIVE))
        else:
            start_exclusive = None

        if QUERY_END_EXCLUSIVE in request.GET:
            try:
                end_exclusive = datetime.datetime.utcfromtimestamp(int(request.GET.get(QUERY_END_EXCLUSIVE)))
            except ValueError:
                raise InvalidRange("Invalid time range end value: '%s'" % request.GET.get(QUERY_END_EXCLUSIVE))
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

    def basic_filter_value_to_python(self, value):
        value = super(StreamResource, self).basic_filter_value_to_python(value)

        if isinstance(value, basestring):
            try:
                # If we can convert the string to the integer, we assume it is an integer.
                return int(value)
            except ValueError:
                pass

            try:
                # If we can convert the string to the float, we assume it is a float.
                return float(value)
            except ValueError:
                pass

        return value

    def filter_value_to_python(self, value, field_name, filters, filter_expr):
        if field_name in ('in', 'nin', 'all'):
            value = self.value_to_list(filters, filter_expr)
            value = [self.basic_filter_value_to_python(v) for v in value]

        else:
            value = self.basic_filter_value_to_python(value)

        return value

    def build_schema(self):
        data = super(StreamResource, self).build_schema()

        data['fields']['value_type'].update({
            'choices': datastream.VALUE_TYPES,
        })
        data['fields']['value_downsamplers'].update({
            'choices': datastream.VALUE_DOWNSAMPLERS.keys(),
        })
        data['fields']['highest_granularity'].update({
            'choices': datastream.Granularity.values,
        })
        data['fields']['time_downsamplers'].update({
            'choices': datastream.TIME_DOWNSAMPLERS.keys(),
        })

        return data
