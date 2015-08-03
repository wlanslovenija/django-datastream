Installation
============

Inside a virtualenv_, using pip_ simply by doing::

    pip install django-datastream

.. _virtualenv: https://pypi.python.org/pypi/virtualenv
.. _pip: http://pypi.python.org/pypi/pip

Or install from source_ directly.

.. _source: https://github.com/wlanslovenija/django-datastream

If installing from source, you can at this point try out :ref:`demo <demo>`, or proceed with integration with your Django project.

You should add ``django_datastream`` to ``INSTALLED_APPS`` in your ``settings.py``.

Suggested settings are::

    INSTALLED_APPS += (
        'tastypie',
        'django_datastream',
    )

    USE_TZ = True

    MONGO_DATABASE_NAME = 'project_name'
    MONGO_DATABASE_OPTIONS = {
        'tz_aware': USE_TZ,
    }

    DATASTREAM_BACKEND = 'datastream.backends.mongodb.Backend'
    DATASTREAM_BACKEND_SETTINGS = {
        'database_name': MONGO_DATABASE_NAME,
        'tz_aware': USE_TZ,
    }

    # JSONP support as well
    TASTYPIE_DEFAULT_FORMATS = ('json', 'jsonp', 'xml')
