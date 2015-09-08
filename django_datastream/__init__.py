import importlib

from django.conf import settings
from django.core import exceptions

from datastream import Datastream


datastream = None


def init_datastream(datastream_backend, datastream_backend_settings):
    backend = datastream_backend

    if isinstance(backend, basestring):
        i = backend.rfind('.')
        module, attr = backend[:i], backend[i + 1:]

        try:
            mod = importlib.import_module(module)
        except ImportError, exception:
            raise exceptions.ImproperlyConfigured("Error importing datastream backend %s: %s" % (module, exception))
        try:
            cls = getattr(mod, attr)
        except AttributeError:
            raise exceptions.ImproperlyConfigured("Module '%s' does not define a '%s' datastream backend" % (module, attr))

        backend = cls(**datastream_backend_settings)

    return Datastream(backend)

# Load the backend as specified in configuration
if getattr(settings, 'DATASTREAM_BACKEND', None) is not None:
    datastream = init_datastream(settings.DATASTREAM_BACKEND, getattr(settings, 'DATASTREAM_BACKEND_SETTINGS', {}))
