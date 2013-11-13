from __future__ import absolute_import

from django.conf import settings
from django.core import exceptions
from django.utils import importlib

from datastream import Datastream

try:
    from django.db.models.constants import LOOKUP_SEP
except ImportError:
    # To support Django 1.4 we move to location where Django 1.5+ has constants
    import sys
    from django.db.models.sql import constants
    import django.db.models
    django.db.models.constants = constants
    sys.modules['django.db.models.constants'] = django.db.models.constants

datastream = None

# Load the backend as specified in configuration
if getattr(settings, 'DATASTREAM_BACKEND', None) is not None:
    backend = settings.DATASTREAM_BACKEND

    if isinstance(backend, basestring):
        i = backend.rfind('.')
        module, attr = backend[:i], backend[i + 1:]

        try:
            mod = importlib.import_module(module)
        except ImportError, e:
            raise exceptions.ImproperlyConfigured('Error importing datastream backend %s: "%s"' % (module, e))
        try:
            cls = getattr(mod, attr)
        except AttributeError:
            raise exceptions.ImproperlyConfigured('Module "%s" does not define a "%s" datastream backend' % (module, attr))

        backend = cls(**getattr(settings, 'DATASTREAM_BACKEND_SETTINGS', {}))

    datastream = Datastream(backend)
