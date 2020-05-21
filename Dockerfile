# You should always specify a full version here to ensure all of your developers
# are running the same version of Node.
FROM node:8

# The base node image sets a very verbose log level.
ENV NPM_CONFIG_LOGLEVEL warn

# Set up working directory
# RUN mkdir /app Node should contain this directory

WORKDIR /app

# Copy all local files into the image.
COPY package.json /app/package.json
RUN npm install
COPY . /app

# Tell Docker about the port we'll run on.
EXPOSE 80

# Entrypoint
CMD ["npm", "start"]
