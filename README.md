## 下载地址
https://jianghuaangte.github.io/download-docker-images/

## gz文件
```shell=
docker load -i xxx.tar.gz
```

## part 分割文件
```shell
cat xxx.part.* > xxx.tar
docker load -i xxx.tar
```
