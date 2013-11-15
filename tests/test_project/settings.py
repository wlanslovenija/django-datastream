# Django settings for test_project project

import os.path

settings_dir = os.path.abspath(os.path.dirname(__file__))
default_template_dir = os.path.join(settings_dir, 'templates')

DEBUG = True
TEMPLATE_DEBUG = DEBUG

ADMINS = (
)

MANAGERS = ADMINS
# We are not really using a relational database, but tests fail without
# defining it because flush command is being run, which expects it
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Make this unique, and don't share it with anybody
SECRET_KEY = 'sq=uf!nqw=aibl+y1&5pp=)b7pc=c$4hnh$om*_c48r)^t!ob)'

MIDDLEWARE_CLASSES = (
    'django.middleware.common.CommonMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
)

ROOT_URLCONF = 'test_project.urls'

AUTHENTICATION_BACKENDS = (
    'mongoengine.django.auth.MongoEngineBackend',
)

SESSION_ENGINE = 'mongoengine.django.sessions'

TEST_RUNNER = 'django_datastream.test_runner.DatastreamSuiteRunner'

# Absolute path to the directory static files should be collected to.
# Don't put anything in this directory yourself; store your static files
# in apps' 'static/' subdirectories and in STATICFILES_DIRS.
# Example: '/home/media/media.lawrence.com/static/'
STATIC_ROOT = os.path.join(settings_dir, 'static')

# URL prefix for static files.
# Example: "http://media.lawrence.com/static/"
STATIC_URL = '/static/'

# Additional locations of static files
STATICFILES_DIRS = (
    # Put strings here, like "/home/html/static" or "C:/www/django/static".
    # Always use forward slashes, even on Windows.
    # Don't forget to use absolute paths, not relative paths.
)

# List of finder classes that know how to find static files in
# various locations.
STATICFILES_FINDERS = (
    'django.contrib.staticfiles.finders.FileSystemFinder',
    'django.contrib.staticfiles.finders.AppDirectoriesFinder',
    #    'django.contrib.staticfiles.finders.DefaultStorageFinder',
)

# List of callables that know how to import templates from various sources.
TEMPLATE_LOADERS = (
    'django.template.loaders.filesystem.Loader',
    'django.template.loaders.app_directories.Loader',
)

TEMPLATE_CONTEXT_PROCESSORS = (
    'django.core.context_processors.debug',
    'django.core.context_processors.i18n',
    'django.core.context_processors.media',
    'django.core.context_processors.static',
    'django.contrib.auth.context_processors.auth',
    'django.contrib.messages.context_processors.messages',
)

MIDDLEWARE_CLASSES = (
    'django.middleware.common.CommonMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.middleware.transaction.TransactionMiddleware',
)

TEMPLATE_DIRS = (
    # Put strings here, like "/home/html/django_templates" or "C:/www/django/templates".
    # Always use forward slashes, even on Windows.
    # Don't forget to use absolute paths, not relative paths.
    default_template_dir,
)

INSTALLED_APPS = (
    'django.contrib.staticfiles',
    'tastypie',
    'django_datastream',
    'test_project.test_app',
)

USE_TZ = True

MONGO_DATABASE_NAME = 'test_project'
MONGO_DATABASE_OPTIONS = {
    'tz_aware': USE_TZ,
}

DATASTREAM_BACKEND = 'datastream.backends.mongodb.Backend'
DATASTREAM_BACKEND_SETTINGS = {
    'database_name': MONGO_DATABASE_NAME,
    'tz_aware': USE_TZ,
}

# We use RFC 2822 for better parsing in JavaScript and time-zone support
TASTYPIE_DATETIME_FORMATTING = 'rfc-2822'

# JSONP support as well
TASTYPIE_DEFAULT_FORMATS = ('json', 'jsonp', 'xml')
