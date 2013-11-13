from django.test import simple

from django_datastream import datastream


class DatastreamSuiteRunner(simple.DjangoTestSuiteRunner):
    """
    It is the same as in DjangoTestSuiteRunner, but without relational databases.
    """

    def setup_databases(self, **kwargs):
        # TODO: Setup test-only database
        pass

    def teardown_databases(self, old_config, **kwargs):
        datastream.delete_streams()
