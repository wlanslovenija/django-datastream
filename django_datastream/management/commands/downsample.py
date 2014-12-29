import datetime
import optparse

from django.core.management import base

from django_datastream import datastream


class Command(base.BaseCommand):
    option_list = base.BaseCommand.option_list + (
        optparse.make_option(
            '--until', '-u', action='store', type='string', dest='until', default=None,
            help="Until when to downsample, format 'yyyy-mm-ddThh:mm:ss' (i.e. '2007-03-04T21:08:12')",
        ),
    )

    help = "Downsample all pending streams."

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
