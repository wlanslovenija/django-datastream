from django.conf import settings

from tastypie import exceptions, paginator


class Paginator(paginator.Paginator):
    # Tastypie paginator does not return any previous page if page start would
    # go below zero offset, even if there are still items to be fetched. For
    # example, if current offset is 7 and limit is 10, there are still 7 items
    # available when going backwards, but previous link will be None. Instead,
    # we in this paginator make the limit smaller so that it fits. For the above
    # example, previous page would have offset 0 and limit 7.

    def get_previous(self, limit, offset):
        # If offset is non-zero and smaller than limit, we set limit to
        # the offset. This will make the first page smaller, but we will
        # paginate over all items.
        if 0 < offset < limit:
            limit = offset

        if offset - limit < 0:
            return None

        return self._generate_uri(limit, offset-limit)

    def page(self):
        page = super(Paginator, self).page()

        # Always add pointers to previous and next page, even if there are no previous or next pages.
        # (In default Tastypie code logic this can happen when limit is 0, which can happen in our
        # DetailPaginator.)
        if 'previous' not in page['meta']:
            page['meta']['previous'] = None
        if 'next' not in page['meta']:
            page['meta']['next'] = None

        return page


class BatchSizePaginator(Paginator):
    # This paginator optimizes batch size when using datastream.

    def get_slice(self, limit, offset):
        # Mostly just a copy of parent get_slice.

        if limit == 0:
            return self.objects[offset:]

        # Optimization, this is a method of datastream.api.Datapoints and datastream.api.Streams
        self.objects.batch_size(limit)

        return self.objects[offset:offset + limit]


class DetailPaginator(BatchSizePaginator):
    # This paginator allows limit to be zero to return no results.
    # We are using it to paginate datapoints in the detail view and to
    # allow no datapoints to be requested, but to still get other fields.

    def get_limit(self):
        # Mostly just a copy of parent get_limit, but using
        # API_DETAIL_LIMIT_PER_PAGE and allowing limit to be 0.

        limit = self.request_data.get('limit', self.limit)
        if limit is None:
            limit = getattr(settings, 'API_DETAIL_LIMIT_PER_PAGE', 20)

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
        # Mostly just a copy of parent get_slice.

        if limit == 0:
            # If explicitly zero, return nothing
            return []

        # Optimization, this is a method of datastream.api.Datapoints and datastream.api.Streams
        self.objects.batch_size(limit)

        return self.objects[offset:offset + limit]
