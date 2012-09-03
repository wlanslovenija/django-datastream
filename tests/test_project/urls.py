from django.conf.urls import patterns, include, url

urlpatterns = patterns('',
    url(r'^test/$', 'test_project.test_app.views.test_timeplot'),
    url(r'^api/', include('django_datastream.urls')),
    url(r'^passthrough', include('pushserver.urls')),
)
