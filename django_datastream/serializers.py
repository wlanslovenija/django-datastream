from django.utils import datetime_safe, feedgenerator, timezone

from tastypie import serializers

import ujson


class DatastreamSerializer(serializers.Serializer):
    def to_json(self, data, options=None):
        options = options or {}
        data = self.to_simple(data, options)
        return ujson.dumps(data, ensure_ascii=False)

    def from_json(self, content):
        return ujson.loads(content)

    # We fix RFC 2822 serialization
    # Bug: https://github.com/toastdriven/django-tastypie/pull/656

    def format_datetime(self, data):
        if self.datetime_formatting != 'rfc-2822':
            return super(DatastreamSerializer, self).format_datetime(data)

        return feedgenerator.rfc2822_date(data)

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

    def format_time(self, data):
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
