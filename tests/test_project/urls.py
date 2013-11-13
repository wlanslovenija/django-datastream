from django.conf.urls import patterns, include, url
from django.views import generic

urlpatterns = patterns(
    '',

    url(r'^$', generic.TemplateView.as_view(template_name='demo.html')),
    url(r'^api/', include('django_datastream.urls')),
)
