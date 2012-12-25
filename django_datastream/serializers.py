from tastypie import serializers

import ujson

class DatastreamSerializer(serializers.Serializer):
    def to_json(self, data, options=None):
        """
        Given some Python data, produces JSON output.
        """

        options = options or {}
        data = self.to_simple(data, options)
        return ujson.dumps(data)

    def from_json(self, content):
        """
        Given some JSON data, returns a Python dictionary of the decoded data.
        """

        return ujson.loads(content)
