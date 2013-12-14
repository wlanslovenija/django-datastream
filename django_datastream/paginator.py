from django.conf import settings

from tastypie import exceptions, paginator


class Paginator(paginator.Paginator):
    limit_setting = 'API_LIMIT_PER_PAGE'

    def get_limit(self):
        # Mostly just a copy of parent get_limit

        limit = self.request_data.get('limit', self.limit)
        if limit is None:
            limit = getattr(settings, self.limit_setting, 20)

        try:
            limit = int(limit)
        except ValueError:
            raise exceptions.BadRequest("Invalid limit '%s' provided. Please provide a positive integer." % limit)

        if limit < 0:
            raise exceptions.BadRequest("Invalid limit '%s' provided. Please provide a positive integer >= 0." % limit)

        # We allow limit to be 0
        if self.max_limit and limit > self.max_limit:
            return self.max_limit

        return limit

    def get_slice(self, limit, offset):
        if limit == 0:
            # If explicitly zero, return nothing
            return []

        # Optimization, this is a method of datastream.api.Datapoints and datastream.api.Streams
        self.objects.batch_size(limit)

        return self.objects[offset:offset + limit]


class DetailPaginator(Paginator):
    # We use API_DETAIL_LIMIT_PER_PAGE
    limit_setting = 'API_DETAIL_LIMIT_PER_PAGE'
