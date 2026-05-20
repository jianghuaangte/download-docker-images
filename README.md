## gz文件
```shell=
docker load -i xxx.tar.gz
```

## part 分割文件
```shell
cat xxx.part.* > xxx.tar
docker load -i xxx.tar
```
