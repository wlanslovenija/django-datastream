import datetime, optparse, random, re, time

from django.core.management import base
from django.contrib.webdesign import lorem_ipsum

from django_datastream import datastream

re_float = r'[-+]?[0-9]*\.?[0-9]+'
re_int = r'[-+]?\d+'
check_types = re.compile(r'^(int(\(%s,%s\))?|float(\(%s,%s\))?|enum(\((\w|,)+\))?|,)*$' % (re_int, re_int, re_float, re_float))
split_types = re.compile(r'(int|float|enum)(?:\(([^)]+)\))?')

class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option('--streams', '-n', action='store', type='int', dest='nstreams',
                             help="Number of dummy streams to be created (default: 3)."),
        optparse.make_option('--interval', '-i', action='store', type='int', dest='interval', default=5,
                             help="Interval between inserts of dummy datapoints (default: every 5 seconds)."),
        optparse.make_option('--types', '-t', action='store', type='string', dest='types',
                             help="Stream types given as comma-separated values of int, float, or enum (default: empty string). Range can be specified in brackets."),
        optparse.make_option('--flush', action='store_true', dest='flush',
                             help="Remove all data stream entries from the database."),
        optparse.make_option('--demo', action='store_true', dest='demo',
                             help="Build demo datastream."),
        optparse.make_option('--span', '-s', action='store', type='string', dest='span', default='',
                             help="Time span <span> time span until now (i.e. 7d) or <from to> format yyyy-mm-ddThh:mm:ss (i.e. 2007-03-04T12:00:00 2007-04-10T12:00:00)"),
        )

    help = "Regularly append dummy datapoints to streams."

    def handle(self, *args, **options):
        verbose = int(options.get('verbosity'))
        interval = options.get('interval')
        nstreams = options.get('nstreams')
        types = options.get('types')
        flush = options.get('flush')
        demo = options.get('demo')
        span = options.get('span')

        if nstreams is None and types is None and not demo and flush:
            datastream.remove_data()
            return
        elif flush:
            raise base.CommandError("Do you really want to remove datastream data from the database? Use only --flush parameter.")

        if nstreams is None and types is None and not flush and demo:
            types = 'int(0,10),float(-2,2),float(0,100)'
            if span == '':
                span = '2d'
        else:
            raise base.CommandError("The demo is not supported with other parameters.")

        f = t = None
        span = span.split(' ')
        if len(span) == 1:
            span = span[0]
            for val, key in (('days', 'd'), ('hours', 'h')):
                if span[-1] == key:
                    #try:
                        t = datetime.datetime.utcnow()
                        last_timestamp = datastream._last_timestamp().replace(tzinfo=None)
                        f = max(t - datetime.timedelta(**{val: int(span[:-1])}), last_timestamp + datetime.timedelta(seconds=interval))
                        break
                    #except:
                    #    raise base.CommandError("Timespan must be an integer.")
            else:
                raise base.CommandError("Unknown time span unit %s." % span[-1])

        elif len(span) == 2:
            try:
                f, t = map(lambda x: datetime.datetime.strptime(x, '%Y-%m-%dT%H:%M:%S'), span)
            except ValueError:
                raise base.CommandError("Use time format like yyyy-mm-ddThh:mm:ss (i.e. 2007-03-04T21:08:12).")

        if nstreams is None and types is None:
            nstreams = 3

        if types and check_types.match(types):
            types = split_types.findall(types)
            if nstreams is not None and len(types) != nstreams:
                raise base.CommandError("Number of stream types does not mach number of streams.")

            nstreams = len(types)

        elif types:
            raise base.CommandError("Invalid stream types string. Must be a comma separated list of <int|float|enum>[(start,end)|(enum values)].")

        streams = []
        for i in range(nstreams):
            if types is None or types[i][0] != 'enum':
                downsamplers = datastream.backend.value_downsamplers
            else:
                downsamplers = []

            stream_id = datastream.ensure_stream(({'name': 'stream_%d' % i},),
                                                 ('foobar', {'stream_number': i},
                                                  {'description': lorem_ipsum.paragraph()}),
                                                 downsamplers, datastream.Granularity.Seconds)

            streams.append((stream_id, types[i] if types is not None else ('int', '')))

        typedef = {
            'int': (int, random.randint, '0,100'),
            'float': (float, random.uniform, '0,100'),
            'enum': (str, lambda *x: random.choice(x), 'a,b,c'),
        }

        if not (f is None or t is None):
            if verbose > 1:
                td = t - f
                self.stdout.write("Inserting %d values...\n" % ((td.seconds + td.days * 24 * 3600) // interval * len(streams)))

            while f <= t:
                for stream_id, type in streams:
                    type, domain = type
                    type, rnd, rng = typedef[type]
                    value = rnd(*map(type, (rng if domain is '' else domain).split(',')))
                    datastream.append(stream_id, value, f)

                f += datetime.timedelta(seconds=interval)

            if verbose > 1:
                self.stdout.write("Downsampling...\n")

            datastream.downsample_streams()

        while True:
            for stream_id, type in streams:
                type, domain = type
                type, rnd, rng = typedef[type]
                value = rnd(*map(type, (rng if domain is '' else domain).split(',')))

                if verbose > 1:
                    self.stdout.write("Appending value '%s' to stream '%s'.\n" % (value, stream_id))
                datastream.append(stream_id, value)

            datastream.downsample_streams()
            time.sleep(interval)
