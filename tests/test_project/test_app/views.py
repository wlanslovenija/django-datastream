import re, datetime

from pymongo import Connection
from django.shortcuts import render_to_response
from django.template import RequestContext
from django.http import HttpResponse
from django.core.exceptions import ValidationError

def test_timeplot(request):

    return render_to_response('datastream_usecase.html',
                              context_instance = RequestContext(request))
