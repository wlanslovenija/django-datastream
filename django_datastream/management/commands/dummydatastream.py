import optparse, random, re, time

from django.core.management import base
from django.contrib.webdesign import lorem_ipsum

from django_datastream import datastream

re_float = r'[-+]?[0-9]*\.?[0-9]+'
re_int = r'[-+]?\d+'
check_types = re.compile(r'^(int(\(%s,%s\))?|float(\(%s,%s\))?|enum(\((\w|,)+\))?|,)*$' % (re_int, re_int, re_float, re_float))
split_types = re.compile(r'(int|float|enum)(?:\(([^)]+)\))?')

class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option('--metrics', '-m', action='store', type="int", dest='metrics',
            help="Number of dummy metrics to be created (default: 3)."),
        optparse.make_option('--interval', '-i', action='store', type="int", dest='interval', default=10,
            help="Interval between inserts of dummy datapoints (default: every 10 seconds)."),
        optparse.make_option('--types', '-t', action='store', type="string", dest='types',
            help="Metric types, comma-separated values of int, float, or enum (default: empty string). Range can be specified in brackets."),
        )
    help = "Regularly inserts dummy datapoints into metrics."

    def handle(self, *args, **options):
        verbose = int(options.get('verbosity'))
        interval = options.get('interval')
        nmetrics = options.get('metrics')
        types = options.get('types')

        if nmetrics is None and types is None:
            nmetrics = 3

        if types and check_types.match(types):
            types = split_types.findall(types)
            if nmetrics is not None and len(types) != nmetrics:
                raise base.CommandError('Number of metric types does not mach number of metrics.')

            nmetrics = len(types)

        elif types:
            raise base.CommandError('Invalid metric types string. Must be a comma separated list of <int|float|enum>[(start,end)|(enum values)].')

        metrics = []
        for i in range(nmetrics):
            downsamplers = datastream.backend.value_downsamplers if types is not None and types[i][0] != 'enum' else []
            metric_id = datastream.ensure_metric(({'name': 'metric_%d' % i},), ('foobar', {'metric_number': i}, {'description': lorem_ipsum.paragraph()}), downsamplers, datastream.Granularity.Seconds)
            metrics.append((metric_id, types[i] if types is not None else ('int', None)))

        typedef = {'int': (int, random.randint, '0,100'),
                   'float': (float, random.uniform, '0,100'),
                   'enum': (str, lambda *x: random.choice(x), 'a,b,c')}

        while True:
            for metric_id, type in metrics:
                type, domain = type
                type, rnd, rng = typedef[type]
                value = rnd(*map(type, (rng if domain is None else domain).split(',')))

                if verbose > 1:
                    self.stdout.write("Inserting value '%s' into metric '%s'.\n" % (value, metric_id))
                datastream.insert(metric_id, value)

            datastream.downsample_metrics()

            time.sleep(interval)



