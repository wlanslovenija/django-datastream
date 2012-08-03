#!/usr/bin/env python

import os

from setuptools import setup, find_packages

VERSION = '0.1'

if __name__ == '__main__':
    setup(
        name = 'django-datastream',
        version = VERSION,
        description = "Django HTTP interface to Datastream API time-series library.",
        long_description = open(os.path.join(os.path.dirname(__file__), 'README.rst')).read(),
        author = 'wlan slovenija',
        author_email = 'open@wlan-si.net',
        url = 'https://github.com/wlanslovenija/django-datastream',
        license = 'AGPLv3',
        packages = find_packages(),
        package_data = {},
        classifiers = [
            'Development Status :: 4 - Beta',
            'Environment :: Web Environment',
            'Intended Audience :: Developers',
            'License :: OSI Approved :: GNU Affero General Public License v3',
            'Operating System :: OS Independent',
            'Programming Language :: Python',
            'Framework :: Django',
        ],
        include_package_data = True,
        zip_safe = False,
        install_requires = [
            'Django>=1.2',
            'datastream>=0.1',
        ],
    )
