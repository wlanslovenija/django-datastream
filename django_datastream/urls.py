from django.conf import urls

from tastypie import api

from . import resources

v1_api = api.Api(api_name='v1')
v1_api.register(resources.StreamResource())

urlpatterns = urls.patterns(
    '',

    urls.url(r'^', urls.include(v1_api.urls)),
)
