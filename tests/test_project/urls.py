from django.conf.urls import patterns, include, url

urlpatterns = patterns('',
    url(r'^$', 'test_project.test_app.views.timeplot'),
    url(r'^api/', include('django_datastream.urls')),
)
