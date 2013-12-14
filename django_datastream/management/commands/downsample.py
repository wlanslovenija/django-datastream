import datetime
import optparse

from django.core.management import base

import pytz

from django_datastream import datastream


class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option(
            '--until', '-u', action='store', type='string', dest='until', default=None,
            help="Until when to downsample, format 'yyyy-mm-ddThh:mm:ss' (i.e. '2007-03-04T21:08:12')",
        ),
    )

    help = "Downsample all pending streams."

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
        until = options.get('until')

        if until:
            try:
                # TODO: Support also timezone in the datetime format
                until = datetime.datetime.strptime(until, '%Y-%m-%dT%H:%M:%S')
            except ValueError:
                raise base.CommandError("Use time format 'yyyy-mm-ddThh:mm:ss' (i.e. '2007-03-04T21:08:12').")
        else:
            # To make sure is None and not empty string
            until = None

        if verbose > 1:
            self.stdout.write("Downsampling.\n")

        datastream.downsample_streams(until=until)

        if verbose > 1:
            self.stdout.write("Done.\n")
