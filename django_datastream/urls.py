from django.conf.urls import patterns, include, url

from tastypie import api

from . import resources

v1_api = api.Api(api_name='v1')
v1_api.register(resources.MetricResource())

urlpatterns = patterns('',
    url(r'^', include(v1_api.urls)),
)
