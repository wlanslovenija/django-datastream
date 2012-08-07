import optparse, random, time

from django.core.management import base
from django.contrib.webdesign import lorem_ipsum

from django_datastream import datastream

class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option('--metrics', '-m', action='store', type="int", dest='metrics', default=3,
            help="Number of dummy metrics to be created (default: 3)."),
        optparse.make_option('--interval', '-i', action='store', type="int", dest='interval', default=10,
            help="Interval between inserts of dummy datapoints (default: every 10 seconds)."),
    )
    help = "Regularly inserts dummy datapoints into metrics."

    def handle(self, *args, **options):
        verbose = options.get('verbosity')
        interval = options.get('interval')

        metrics = []
        for i in range(options.get('metrics')):
            metric_id = datastream.ensure_metric(({'name': 'metric_%d' % i},), ('foobar', {'metric_number': i}, {'description': lorem_ipsum.paragraph()}), datastream.backend.downsamplers, datastream.Granularity.Seconds)
            metrics.append(metric_id)

        while True:
            for metric_id in metrics:
                # TODO: Support different types of values
                # TODO: Support different ranges
                value = random.randrange(0, 100)
                if verbose > 1:
                    self.stdout.write("Inserting value '%d' into metric '%s'.\n" % (value, metric_id))
                datastream.insert(metric_id, value)

            datastream.downsample_metrics()

            time.sleep(interval)
