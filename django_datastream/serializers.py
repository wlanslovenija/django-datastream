import datetime
import itertools

from django.utils import datetime_safe, feedgenerator, timezone

from tastypie import serializers

import ujson

import datastream


class DatastreamSerializer(serializers.Serializer):
    def to_json(self, data, options=None):
        options = options or {}
        # We set options so that we know in to_simple that we are calling it from to_json and not
        # from somewhere else, so that we know that we can use __json__ attribute, if it exists.
        options['to_json'] = True
        data = self.to_simple(data, options)
        return ujson.dumps(data, ensure_ascii=False)

    def from_json(self, content):
        return ujson.loads(content)

    def to_simple(self, data, options):
        # In our ujson fork we allow data to have a special
        # __json__ method which outputs raw JSON to be directly
        # included in the output. This can speedup serialization
        # when data is already backed by JSON content.
        # See https://github.com/esnme/ultrajson/pull/157
        if options.get('to_json', False) and hasattr(data, '__json__'):
            return data

        if isinstance(data, datastream.Datapoints):
            return itertools.imap(lambda d: self.to_simple(d, options), data)

        return super(DatastreamSerializer, self).to_simple(data, options)

    def to_etree(self, data, options=None, name=None, depth=0):
         if isinstance(data, datastream.Datapoints):
             data = [self.to_simple(d, options) for d in data]

         return super(DatastreamSerializer, self).to_etree(data, options, name, depth)

    # We want to keep timezone information (Tastypie removes it).
    def format_datetime(self, data):
        data = self._make_aware(data)

        if self.datetime_formatting == 'rfc-2822':
            # We fix RFC 2822 serialization
            # See https://github.com/toastdriven/django-tastypie/pull/656
            return feedgenerator.rfc2822_date(data)
        if self.datetime_formatting == 'iso-8601-strict':
            # Remove microseconds to strictly adhere to ISO-8601.
            data = data - datetime.timedelta(microseconds=data.microsecond)

        iso_datetime = data.isoformat()

        # Can we serialize into less bytes?
        if iso_datetime.endswith('+00:00'):
            iso_datetime = iso_datetime[:-6] + 'Z'

        return iso_datetime

    def format_date(self, data):
        if self.datetime_formatting != 'rfc-2822':
            return super(DatastreamSerializer, self).format_date(data)

        # We can't use strftime() because it produces locale-dependant results, so
        # we have to map english month and day names manually
        months = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',)
        # Support datetime objects older than 1900
        date = datetime_safe.new_date(data)
        # We do this ourselves to be timezone aware, email.Utils is not tz aware
        month = months[date.month - 1]
        return date.strftime('%%d %s %%Y' % month)

    def _make_aware(self, data):
        if timezone.is_naive(data):
            return timezone.make_aware(data, timezone.utc)

        return data

    def format_time(self, data):
        data = self._make_aware(data)

        if self.datetime_formatting != 'rfc-2822':
            return super(DatastreamSerializer, self).format_time(data)

        time_str = data.strftime('%H:%M:%S ')
        if timezone.is_aware(data):
            offset = data.tzinfo.utcoffset(data)
            tz = (offset.days * 24 * 60) + (offset.seconds // 60)
            hour, minute = divmod(tz, 60)
            return time_str + "%+03d%02d" % (hour, minute)
        else:
            return time_str + '-0000'
