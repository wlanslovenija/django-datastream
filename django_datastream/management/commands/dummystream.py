import datetime
import itertools
import optparse
import random
import re
import time

from django.core.management import base

try:
    # Moved in Django 1.8
    from django.utils import lorem_ipsum
except ImportError:
    from django.contrib.webdesign import lorem_ipsum

import pytz

from django_datastream import datastream

re_float = r'[-+]?[0-9]*\.?[0-9]+'
re_int = r'[-+]?\d+'
check_types = re.compile(r'^(int(\(%s,%s\))?|float(\(%s,%s\))?|enum(\((\w|,)+\))?|graph(\(%s,%s\))?|,)*$' % (re_int, re_int, re_float, re_float, re_int, re_int))
split_types = re.compile(r'(int|float|enum|graph)(?:\(([^)]+)\))?')

DEMO_TYPE = 'int(0,10),float(-2,2),float(0,100)'
DEMO_SPAN = '2d'

DEFAULT_NSTREAMS = 3
DEFAULT_INTERVAL = 5 # seconds


def random_graph(number_of_nodes, number_of_edges):
    # Produces a graph picked randomly out of the set of all graphs
    # with number_of_nodes nodes and number_of_edges edges. Based on
    # NetworkX gnm_random_graph.

    nodes = range(number_of_nodes)
    graph = {
        'v': [{'i': i} for i in nodes],
        'e': [],
    }

    if number_of_nodes == 1:
        return graph

    max_edges = number_of_nodes * (number_of_nodes - 1)
    if number_of_edges >= max_edges:
        # Complete graph.
        for f, t in itertools.permutations(nodes, 2):
            graph['e'].append({
                'f': f,
                't': t,
            })
        return graph

    edges = set()
    while len(edges) < number_of_edges:
        f = random.choice(nodes)
        t = random.choice(nodes)
        if f == t or (f, t) in edges:
            continue
        else:
            graph['e'].append({
                'f': f,
                't': t,
            })
            edges.add((f, t))

    return graph


TYPES = {
    'int': (int, random.randint, '0,100'),
    'float': (float, random.uniform, '0,100'),
    'enum': (str, lambda *x: random.choice(x), 'a,b,c'),
    'graph': (int, random_graph, '4,6'),
}


class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option(
            '--streams', '-n', action='store', type='int', dest='nstreams',
            help="Number of dummy streams to be created (default: %s)." % DEFAULT_NSTREAMS,
        ),
        optparse.make_option(
            '--interval', '-i', action='store', type='int', dest='interval', default=DEFAULT_INTERVAL,
            help="Interval between inserts of dummy datapoints (default: every %s seconds)." % DEFAULT_INTERVAL,
        ),
        optparse.make_option(
            '--types', '-t', action='store', type='string', dest='types',
            help="Stream types given as comma-separated values of 'int', 'float', 'enum', or 'graph' (default: int). Domain can be specified in parenthesis (defaults: %s)" % ", ".join(["%s(%s)" % (name, d) for name, (type, f, d) in TYPES.iteritems()]),
        ),
        optparse.make_option(
            '--flush', action='store_true', dest='flush',
            help="Remove all datastream data from the database.",
        ),
        optparse.make_option(
            '--demo', action='store_true', dest='demo',
            help="Build demo datastream (type: %s, span: %s)." % (DEMO_TYPE, DEMO_SPAN),
        ),
        optparse.make_option(
            '--span', '-s', action='store', type='string', dest='span', default='',
            help="Time span: <span> time span until now (i.e. '7d'), or <from to> format 'yyyy-mm-ddThh:mm:ss' (i.e. '2007-03-04T12:00:00 2007-04-10T12:00:00')",
        ),
        optparse.make_option(
            '--no-real-time', action='store_true', dest='norealtime', default=False,
            help="Just insert for the given time span without appending in real-time.",
        ),
    )

    help = "Regularly append dummy datapoints to streams."

    def last_timestamp(self, streams):
        timestamp = datetime.datetime.min
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=pytz.utc)

        for stream_id, types in streams:
            try:
                t = datastream.get_data(stream_id, datastream.Granularity.Seconds, datetime.datetime.min, datetime.datetime.max, reverse=True)[0]['t']

                if t.tzinfo is None:
                    t = t.replace(tzinfo=pytz.utc)

                if t > timestamp:
                    timestamp = t
            except IndexError:
                continue

        return timestamp

    def handle(self, *args, **options):
        verbose = int(options.get('verbosity'))
        interval = options.get('interval')
        nstreams = options.get('nstreams')
        types = options.get('types')
        flush = options.get('flush')
        demo = options.get('demo')
        span = options.get('span')
        norealtime = options.get('norealtime')

        if nstreams is None and types is None and not demo and flush:
            datastream.delete_streams()
            return
        elif flush:
            raise base.CommandError("Do you really want to remove all datastream data from the database? Use only '--flush' parameter.")

        if nstreams is None and types is None and not flush and demo:
            types = DEMO_TYPE
            if span == '':
                span = DEMO_SPAN
        elif demo:
            raise base.CommandError("In demo mode other parameters are fixed.")

        if nstreams is None and types is None:
            nstreams = DEFAULT_NSTREAMS

        if types and check_types.match(types):
            types = split_types.findall(types)
            if nstreams is not None and len(types) != nstreams:
                raise base.CommandError("Number of stream types does not mach number of streams.")

            nstreams = len(types)

        elif types:
            raise base.CommandError("Invalid stream types string. Must be a comma separated list of <int|float|enum>[(start,end)|(enum values)].")

        streams = []
        for i in range(nstreams):
            if types is not None:
                typ = types[i]
            else:
                typ = ('int', '')

            if typ[0] == 'enum':
                value_type = 'nominal'
                downsamplers = ['count']
            elif typ[0] == 'graph':
                value_type = 'graph'
                downsamplers = ['count']
            else:
                value_type = 'numeric'
                downsamplers = datastream.backend.value_downsamplers

            visualization_value_downsamplers = []
            for downsampler in ['mean', 'min', 'max']:
                if downsampler in downsamplers:
                    visualization_value_downsamplers.append(downsampler)

            type_constructor, random_function, default_domain = TYPES[typ[0]]
            domain = typ[1] or default_domain
            domain_range = [type_constructor(d) for d in domain.split(',')]

            stream_id = datastream.ensure_stream(
                {'title': 'Stream %d' % i},
                {
                    'description': lorem_ipsum.paragraph(),
                    'unit_description': 'random, domain: %s' % domain,
                    'stream_number': i,
                    'visualization': {
                        'type': 'state' if typ is 'enum' else 'line',
                        'hidden': True if typ is 'graph' else False,
                        'value_downsamplers': visualization_value_downsamplers,
                        'time_downsamplers': ['mean'],
                        'minimum': domain_range[0] if value_type == 'numeric' else None,
                        'maximum': domain_range[1] if value_type == 'numeric' else None,
                    },
                },
                downsamplers,
                datastream.Granularity.Seconds,
                value_type=value_type,
            )

            streams.append((stream_id, typ))

        span = span.split(' ')
        if len(span) == 1 and span[0]:
            span = span[0]
            for val, key in (('days', 'd'), ('hours', 'h'), ('minutes', 'm'), ('seconds', 's')):
                if span[-1] == key:
                    try:
                        s = int(span[:-1])
                    except ValueError:
                        raise base.CommandError("Time span value must be an integer.")

                    span_to = datetime.datetime.now(pytz.utc)
                    last_timestamp = self.last_timestamp(streams)

                    span_from = max(
                        span_to - datetime.timedelta(**{val: s}),
                        last_timestamp + datetime.timedelta(seconds=interval)
                    )

                    break
            else:
                raise base.CommandError("Unknown time span unit '%s'." % span[-1])

        elif len(span) == 2:
            try:
                # TODO: Support also timezone in the datetime format
                span_from, span_to = [datetime.datetime.strptime(x, '%Y-%m-%dT%H:%M:%S') for x in span]
            except ValueError:
                raise base.CommandError("Use time format 'yyyy-mm-ddThh:mm:ss' (i.e. '2007-03-04T21:08:12').")

        else:
            raise base.CommandError("Invalid time span parameter. It should be one or two space-delimited values.")

        if span_from is not None and span_to is not None and span_from <= span_to:
            if verbose > 1:
                td = span_to - span_from
                self.stdout.write("Appending %d values from %s to %s.\n" % (((td.seconds + td.days * 24 * 3600) // interval * len(streams)), span_from, span_to))

            while span_from <= span_to:
                for stream_id, (typ, domain) in streams:
                    type_constructor, random_function, default_domain = TYPES[typ]
                    value = random_function(*[type_constructor(d) for d in (domain or default_domain).split(',')])
                    datastream.append(stream_id, value, span_from)

                span_from += datetime.timedelta(seconds=interval)

            if verbose > 1:
                self.stdout.write("Done. Downsampling.\n")

            datastream.downsample_streams(until=span_to)

        if norealtime:
            return

        if verbose > 1:
            self.stdout.write("Appending real-time value(s) to stream(s) every %s seconds.\n" % interval)

        while True:
            for stream_id, (typ, domain) in streams:
                type_constructor, random_function, default_domain = TYPES[typ]
                value = random_function(*[type_constructor(d) for d in (domain or default_domain).split(',')])

                if verbose > 1:
                    self.stdout.write("Appending value '%s' to stream '%s'.\n" % (value, stream_id))

                datastream.append(stream_id, value)

            datastream.downsample_streams()

            time.sleep(interval)
