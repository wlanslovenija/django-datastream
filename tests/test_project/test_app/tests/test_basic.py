from django.test import client, utils

from test_project import test_runner

@utils.override_settings(DEBUG=True)
class BasicTest(test_runner.MongoEngineTestCase):
    api_name = 'v1'
    c = client.Client()
