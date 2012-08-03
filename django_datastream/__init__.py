from django.conf import settings
from django.core import exceptions
from django.utils import importlib

from datastream import Datastream

datastream = None

# Load the backend as specified in configuration
if getattr(settings, 'DATASTREAM_BACKEND', None) is not None:
    backend = settings['DATASTREAM_BACKEND']

    if isinstance(backend, basestring):
        i = backend.rfind('.')
        module, attr = backend[:i], backend[i+1:]

        try:
            mod = importlib.import_module(module)
        except ImportError, e:
            raise exceptions.ImproperlyConfigured('Error importing datastream backend %s: "%s"' % (path, e))
        try:
            cls = getattr(mod, attr)
        except AttributeError:
            raise exceptions.ImproperlyConfigured('Module "%s" does not define a "%s" datastream backend' % (module, attr))

        backend = cls(getattr(settings, 'DATASTREAM_BACKEND_SETTINGS', {}))

    datastream = Datastream(backend)
